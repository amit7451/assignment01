import { Router, Request, Response } from 'express';
import { config } from '../config';

export function createHealthRoutes(): Router {
  const router = Router();

  router.get('/health/live', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  router.get('/health', async (req: Request, res: Response) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';

    const checkService = async (url: string, name: string) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${url}/health`, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.ok) {
          const data: any = await response.json();
          return { status: 'healthy', data };
        }
        return { status: 'degraded', httpStatus: response.status };
      } catch (err: any) {
        return { status: 'down', error: err.message };
      }
    };

    const [userServiceHealth, notificationServiceHealth] = await Promise.all([
      checkService(config.userServiceUrl, 'user-service'),
      checkService(config.notificationServiceUrl, 'notification-service'),
    ]);

    const isAllHealthy =
      userServiceHealth.status === 'healthy' &&
      notificationServiceHealth.status === 'healthy';

    const statusCode = isAllHealthy ? 200 : 207; // 207 Multi-Status if degraded

    res.status(statusCode).json({
      gateway: {
        status: 'healthy',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      },
      upstreamServices: {
        userService: {
          url: config.userServiceUrl,
          ...userServiceHealth,
        },
        notificationService: {
          url: config.notificationServiceUrl,
          ...notificationServiceHealth,
        },
      },
      timestamp: new Date().toISOString(),
      correlationId,
    });
  });

  return router;
}
