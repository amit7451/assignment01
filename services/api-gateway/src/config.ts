import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export interface ApiGatewayConfig {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  userServiceUrl: string;
  notificationServiceUrl: string;
  corsOrigin: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

export const config: ApiGatewayConfig = {
  port: parseInt(process.env.GATEWAY_PORT || process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_32chars',
  userServiceUrl: process.env.USER_SERVICE_URL || 'http://localhost:8001',
  notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:8002',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
};
