import { Router, Request, Response } from 'express';
import { ApiResponse } from '@system/shared';
import { INotificationRepository } from '../db/notificationRepository';
import { NatsConsumer } from '../events/natsConsumer';

export function createNotificationRoutes(
  repository: INotificationRepository,
  consumer: NatsConsumer
): Router {
  const router = Router();

  // Health check probes
  router.get('/health/live', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  router.get('/health/ready', async (_req: Request, res: Response) => {
    const dbHealthy = await repository.isHealthy();
    const natsHealthy = consumer.isHealthy();
    const isReady = dbHealthy && natsHealthy;

    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'degraded',
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        nats: natsHealthy ? 'connected' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/health', async (_req: Request, res: Response) => {
    const dbHealthy = await repository.isHealthy();
    const natsHealthy = consumer.isHealthy();

    res.status(200).json({
      service: 'notification-service',
      status: dbHealthy && natsHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbHealthy ? 'up' : 'down',
        nats: natsHealthy ? 'up' : 'down',
      },
    });
  });

  // Notification Audit Queries
  router.get('/api/v1/notifications', async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const userId = (req.query.userId as string) || (req.headers['x-user-id'] as string);

    const notifications = await repository.getNotifications(limit, userId);
    const response: ApiResponse = {
      success: true,
      data: {
        total: notifications.length,
        items: notifications,
      },
      meta: { timestamp: new Date().toISOString() },
    };

    res.status(200).json(response);
  });

  // Dead Letter Queue Auditing
  router.get('/api/v1/notifications/dead-letters', async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const deadLetters = await repository.getDeadLetters(limit);

    const response: ApiResponse = {
      success: true,
      data: {
        total: deadLetters.length,
        items: deadLetters,
      },
      meta: { timestamp: new Date().toISOString() },
    };

    res.status(200).json(response);
  });

  return router;
}
