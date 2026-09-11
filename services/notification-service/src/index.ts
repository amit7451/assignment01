import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Logger } from '@system/shared';
import { config } from './config';
import { createNotificationRepository } from './db/notificationRepository';
import { MockEmailProvider } from './providers/emailProvider';
import { NotificationHandler } from './handlers/notificationHandler';
import { NatsConsumer } from './events/natsConsumer';
import { createNotificationRoutes } from './routes/notificationRoutes';

const logger = new Logger({ serviceName: 'notification-service' });

async function bootstrap() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Correlation & Access Logging
  app.use((req: Request, res: Response, next) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || `notif-${Date.now()}`;
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

  // 1. Initialize Persistence
  logger.info('Initializing notification repository...');
  const repository = await createNotificationRepository();

  // 2. Initialize Dispatcher & Handlers
  const emailProvider = new MockEmailProvider();
  const handler = new NotificationHandler(repository, emailProvider);

  // 3. Initialize & Start NATS Consumer Worker
  const consumer = new NatsConsumer(handler, repository);
  try {
    await consumer.start();
  } catch (err: any) {
    logger.warn(`Could not connect to NATS immediately: ${err.message}. Consumer will retry.`);
  }

  // 4. Mount Routes
  app.use(createNotificationRoutes(repository, consumer));

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    });
  });

  const server = app.listen(config.port, () => {
    logger.info(`Notification Service listening on port ${config.port} [env=${config.nodeEnv}]`);
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Gracefully stopping Notification Service...`);
    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        await consumer.stop();
        await repository.close();
        logger.info('Notification Service shutdown complete');
        process.exit(0);
      } catch (err: any) {
        logger.error('Error during shutdown cleanup', { error: err.message });
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error('Graceful shutdown timed out, force exiting');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start Notification Service', { error: err.message, stack: err.stack });
  process.exit(1);
});
