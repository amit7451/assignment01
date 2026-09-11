import { Router, Request, Response } from 'express';
import { IUserRepository } from '../db/database';
import { NatsPublisher } from '../events/natsPublisher';

export function createHealthRoutes(userRepo: IUserRepository, publisher: NatsPublisher): Router {
  const router = Router();

  router.get('/health/live', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  router.get('/health/ready', async (_req: Request, res: Response) => {
    const dbHealthy = await userRepo.isHealthy();
    const natsHealthy = publisher.isHealthy();

    const isReady = dbHealthy && natsHealthy;
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      status: isReady ? 'ready' : 'degraded',
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        nats: natsHealthy ? 'connected' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/health', async (_req: Request, res: Response) => {
    const dbHealthy = await userRepo.isHealthy();
    const natsHealthy = publisher.isHealthy();

    res.status(200).json({
      service: 'user-service',
      status: dbHealthy && natsHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbHealthy ? 'up' : 'down',
        nats: natsHealthy ? 'up' : 'down',
      },
    });
  });

  return router;
}
