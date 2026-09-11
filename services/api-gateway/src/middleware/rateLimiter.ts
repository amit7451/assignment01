import rateLimit from 'express-rate-limit';
import { ApiResponse } from '@system/shared';
import { config } from '../config';

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP. Please try again later.',
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    };
    res.status(429).json(response);
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'TOO_MANY_AUTH_ATTEMPTS',
        message: 'Too many authentication attempts. Please try again in 15 minutes.',
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    };
    res.status(429).json(response);
  },
});
