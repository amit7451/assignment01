import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { ZodError } from 'zod';
import { Logger, ApiResponse } from '@system/shared';
import { config } from './config';
import { createDatabaseRepository } from './db/database';
import { NatsPublisher } from './events/natsPublisher';
import { UserService } from './services/userService';
import { UserController } from './controllers/userController';
import { createUserRoutes } from './routes/userRoutes';
import { createHealthRoutes } from './routes/healthRoutes';

const logger = new Logger({ serviceName: 'user-service' });

async function bootstrap() {
  const app = express();

  // Standard security & parsing middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Correlation ID & request logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || `req-${Date.now()}`;
    res.setHeader('x-correlation-id', correlationId);

    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} [${duration}ms]`, {
        correlationId,
        statusCode: res.statusCode,
      });
    });
    next();
  });

  // Initialize persistence layer
  logger.info('Initializing User database repository...');
  const userRepo = await createDatabaseRepository();

  // Initialize NATS publisher
  logger.info('Initializing NATS publisher...');
  const publisher = new NatsPublisher();
  try {
    await publisher.connect();
  } catch (err: any) {
    logger.warn(`Could not connect to NATS immediately: ${err.message}. Will attempt background reconnection.`);
  }

  // Initialize services and controllers
  const userService = new UserService(userRepo, publisher);
  const userController = new UserController(userService);

  // Mount routes
  app.use(createHealthRoutes(userRepo, publisher));
  app.use('/api/v1', createUserRoutes(userController));

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    });
  });

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = (req.headers['x-correlation-id'] as string);

    if (err instanceof ZodError) {
      const formattedErrors = err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: formattedErrors,
        },
        meta: { timestamp: new Date().toISOString(), correlationId },
      };
      res.status(400).json(response);
      return;
    }

    const statusCode = err.statusCode || (err.code === '23505' ? 409 : 500);
    const message = err.message || 'Internal server error';

    logger.error(`Error processing request: ${message}`, {
      correlationId,
      stack: err.stack,
      statusCode,
    });

    const response: ApiResponse = {
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: statusCode === 500 && config.nodeEnv === 'production' ? 'Internal server error' : message,
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    };

    res.status(statusCode).json(response);
  });

  const server = app.listen(config.port, () => {
    logger.info(`User Service listening on port ${config.port} [env=${config.nodeEnv}]`);
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown of User Service...`);
    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        await publisher.close();
        await userRepo.close();
        logger.info('User Service shutdown complete');
        process.exit(0);
      } catch (err: any) {
        logger.error('Error during shutdown cleanup', { error: err.message });
        process.exit(1);
      }
    });

    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, force exiting');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start User Service', { error: err.message, stack: err.stack });
  process.exit(1);
});
