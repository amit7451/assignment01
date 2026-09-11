import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Logger, ApiResponse } from '@system/shared';
import { config } from './config';
import { correlationIdMiddleware } from './middleware/correlationId';
import { authenticate } from './middleware/auth';
import { apiRateLimiter, authRateLimiter } from './middleware/rateLimiter';
import { createServiceProxy } from './proxy/serviceProxy';
import { createHealthRoutes } from './routes/health';
import { createDocsRoutes } from './routes/docs';

const logger = new Logger({ serviceName: 'api-gateway' });

async function bootstrap() {
  const app = express();

  // 1. Security Headers & CORS
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows Swagger UI to render assets cleanly
    })
  );
  app.use(cors({ origin: config.corsOrigin, credentials: true }));

  // 2. Correlation ID & Distributed Tracing Middleware
  app.use(correlationIdMiddleware);

  // 3. Structured Request Access Logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const correlationId = req.headers['x-correlation-id'] as string;

    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} [${duration}ms]`, {
        correlationId,
        statusCode: res.statusCode,
        ip: req.ip,
      });
    });
    next();
  });

  // 4. OpenAPI Documentation UI & Specs
  app.use(createDocsRoutes());

  // 5. Aggregated Health Checks
  app.use(createHealthRoutes());

  // 6. Public Authentication Routes (User Service)
  // Protected with brute-force rate limiting
  app.use(
    '/api/v1/auth',
    authRateLimiter,
    express.json({ limit: '1mb' }),
    createServiceProxy(config.userServiceUrl, 'user-service')
  );

  // 7. Protected User Profile & Account Routes (User Service)
  // Protected with JWT verification & API rate limiting
  app.use(
    '/api/v1/users',
    apiRateLimiter,
    authenticate,
    express.json({ limit: '1mb' }),
    createServiceProxy(config.userServiceUrl, 'user-service')
  );

  // 8. Protected Notification Audit & Query Routes (Notification Service)
  // Protected with JWT verification & API rate limiting
  app.use(
    '/api/v1/notifications',
    apiRateLimiter,
    authenticate,
    express.json({ limit: '1mb' }),
    createServiceProxy(config.notificationServiceUrl, 'notification-service')
  );

  // 9. Root Welcome & Discovery
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      name: 'Microservices API Gateway',
      version: '1.0.0',
      status: 'online',
      documentation: '/docs',
      health: '/health',
      timestamp: new Date().toISOString(),
    });
  });

  // 10. 404 Not Found Handler
  app.use((req: Request, res: Response) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Endpoint ${req.method} ${req.originalUrl} does not exist on API Gateway`,
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    };
    res.status(404).json(response);
  });

  // 11. Global Error Handler
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';
    logger.error(`Unhandled gateway error: ${err.message}`, {
      correlationId,
      stack: err.stack,
    });

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: config.nodeEnv === 'production' ? 'An unexpected gateway error occurred.' : err.message,
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    };

    res.status(500).json(response);
  });

  const server = app.listen(config.port, () => {
    logger.info(`API Gateway listening on port ${config.port} [env=${config.nodeEnv}]`);
    logger.info(`Documentation available at http://localhost:${config.port}/docs`);
    logger.info(`Health check available at http://localhost:${config.port}/health`);
  });

  // Graceful Shutdown
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down API Gateway...`);
    server.close(() => {
      logger.info('API Gateway HTTP server closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Gateway shutdown timed out, force exiting');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start API Gateway', { error: err.message, stack: err.stack });
  process.exit(1);
});
