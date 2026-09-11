import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@system/shared';
import { UserService } from '../services/userService';

const registerSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }).toLowerCase().trim(),
  password: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
  name: z.string().min(2, { message: 'Name must be at least 2 characters' }).trim(),
  role: z.enum(['user', 'admin']).optional(),
});

const loginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }).toLowerCase().trim(),
  password: z.string().min(1, { message: 'Password is required' }),
});

const updateProfileSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters' }).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'Current password is required' }),
  newPassword: z.string().min(8, { message: 'New password must be at least 8 characters long' }),
});

export class UserController {
  constructor(private userService: UserService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = registerSchema.parse(req.body);
      const correlationId = (req.headers['x-correlation-id'] as string) || req.ip || 'unknown';
      const result = await this.userService.register(validated, correlationId);

      const response: ApiResponse = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          correlationId,
        },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = loginSchema.parse(req.body);
      const correlationId = (req.headers['x-correlation-id'] as string) || req.ip || 'unknown';
      const result = await this.userService.login(validated, correlationId);

      const response: ApiResponse = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          correlationId,
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // User ID injected by API Gateway or extracted from req.headers['x-user-id']
      const userId = (req.headers['x-user-id'] as string) || (req.params.id as string);
      if (!userId) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User ID missing from authentication context' },
        });
        return;
      }

      const user = await this.userService.getProfile(userId);
      const response: ApiResponse = {
        success: true,
        data: user,
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req.headers['x-user-id'] as string) || (req.params.id as string);
      if (!userId) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User ID missing from authentication context' },
        });
        return;
      }

      const validated = updateProfileSchema.parse(req.body);
      const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';
      const updatedUser = await this.userService.updateProfile(userId, validated, correlationId);

      const response: ApiResponse = {
        success: true,
        data: updatedUser,
        meta: { timestamp: new Date().toISOString(), correlationId },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req.headers['x-user-id'] as string);
      if (!userId) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User ID missing from authentication context' },
        });
        return;
      }

      const validated = changePasswordSchema.parse(req.body);
      const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await this.userService.changePassword(
        userId,
        validated,
        correlationId,
        ipAddress,
        userAgent
      );

      const response: ApiResponse = {
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString(), correlationId },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req.headers['x-user-id'] as string);
      if (!userId) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User ID missing from authentication context' },
        });
        return;
      }

      const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';
      await this.userService.deleteUser(userId, correlationId);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Account deleted successfully' },
        meta: { timestamp: new Date().toISOString(), correlationId },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };
}
