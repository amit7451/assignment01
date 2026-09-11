import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiResponse, AuthTokenPayload } from '@system/shared';
import { config } from '../config';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header. Expected Bearer token.',
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    };
    res.status(401).json(response);
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthTokenPayload;

    // Propagate authenticated identity downstream to internal microservices
    req.headers['x-user-id'] = decoded.userId;
    req.headers['x-user-email'] = decoded.email;
    req.headers['x-user-role'] = decoded.role;

    next();
  } catch (err: any) {
    const isExpired = err.name === 'TokenExpiredError';
    const response: ApiResponse = {
      success: false,
      error: {
        code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: isExpired ? 'Access token has expired' : 'Invalid authentication token',
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    };
    res.status(401).json(response);
  }
}

export function authorizeRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.headers['x-user-role'] as string;
    const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';

    if (!userRole || !allowedRoles.includes(userRole)) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        },
        meta: { timestamp: new Date().toISOString(), correlationId },
      };
      res.status(403).json(response);
      return;
    }

    next();
  };
}
