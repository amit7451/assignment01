import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { Logger, ApiResponse } from '@system/shared';

const logger = new Logger({ serviceName: 'api-gateway' });

export function createServiceProxy(targetUrl: string, serviceName: string) {
  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    pathRewrite: (_path, req: any) => req.originalUrl,
    timeout: 10000,
    proxyTimeout: 10000,
    on: {
      proxyReq: (proxyReq, req: any, res) => {
        // Forward correlation ID
        const correlationId = req.headers['x-correlation-id'];
        if (correlationId) {
          proxyReq.setHeader('x-correlation-id', correlationId);
        }

        // Forward injected user claims if authenticated
        if (req.headers['x-user-id']) {
          proxyReq.setHeader('x-user-id', req.headers['x-user-id']);
        }
        if (req.headers['x-user-email']) {
          proxyReq.setHeader('x-user-email', req.headers['x-user-email']);
        }
        if (req.headers['x-user-role']) {
          proxyReq.setHeader('x-user-role', req.headers['x-user-role']);
        }

        // Propagate client remote IP address
        const clientIp = req.ip || req.socket.remoteAddress;
        if (clientIp && !proxyReq.getHeader('x-forwarded-for')) {
          proxyReq.setHeader('x-forwarded-for', clientIp);
        }

        // If body was parsed by express.json(), re-stream it to upstream
        if (req.body && Object.keys(req.body).length > 0) {
          fixRequestBody(proxyReq, req);
        }
      },
      error: (err: any, req: any, res: any) => {
        const correlationId = req.headers['x-correlation-id'] || 'unknown';
        logger.error(`Upstream ${serviceName} error: ${err.message}`, {
          serviceName,
          targetUrl,
          path: req.originalUrl,
          correlationId,
        });

        if (!res.headersSent) {
          const response: ApiResponse = {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: `The upstream ${serviceName} is currently unavailable. Please try again shortly.`,
              details: err.message,
            },
            meta: {
              timestamp: new Date().toISOString(),
              correlationId,
            },
          };
          res.status(503).json(response);
        }
      },
    },
  });
}
