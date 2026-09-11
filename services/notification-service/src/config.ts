import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export interface NotificationServiceConfig {
  port: number;
  nodeEnv: string;
  natsUrl: string;
  natsToken?: string;
  natsUser?: string;
  natsPassword?: string;
  streamName: string;
  consumerDurableName: string;
  databaseUrl: string;
  dbType: 'postgres' | 'sqlite';
  sqlitePath: string;
  emailProvider: 'mock' | 'smtp';
  emailFrom: string;
}

export const config: NotificationServiceConfig = {
  port: parseInt(process.env.NOTIFICATION_SERVICE_PORT || process.env.PORT || '8002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  natsUrl: process.env.NATS_URL || 'nats://localhost:4222',
  natsToken: process.env.NATS_TOKEN || undefined,
  natsUser: process.env.NATS_USER || undefined,
  natsPassword: process.env.NATS_PASSWORD || undefined,
  streamName: process.env.NATS_STREAM_NAME || 'USER_EVENTS',
  consumerDurableName: process.env.NOTIFICATION_DURABLE_NAME || 'notification-service-worker',
  databaseUrl: process.env.NOTIFICATION_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/notification_db',
  dbType: (process.env.NOTIFICATION_DB_TYPE || process.env.DB_TYPE || 'postgres') as 'postgres' | 'sqlite',
  sqlitePath: process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'notification.sqlite'),
  emailProvider: (process.env.EMAIL_PROVIDER || 'mock') as 'mock' | 'smtp',
  emailFrom: process.env.EMAIL_FROM || 'noreply@microservices.system',
};
