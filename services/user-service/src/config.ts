import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export interface UserServiceConfig {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  natsUrl: string;
  natsToken?: string;
  natsUser?: string;
  natsPassword?: string;
  databaseUrl: string;
  dbType: 'postgres' | 'sqlite';
  sqlitePath: string;
}

export const config: UserServiceConfig = {
  port: parseInt(process.env.USER_SERVICE_PORT || process.env.PORT || '8001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_32chars',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  natsUrl: process.env.NATS_URL || 'nats://localhost:4222',
  natsToken: process.env.NATS_TOKEN || undefined,
  natsUser: process.env.NATS_USER || undefined,
  natsPassword: process.env.NATS_PASSWORD || undefined,
  databaseUrl: process.env.USER_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/user_db',
  dbType: (process.env.USER_DB_TYPE || process.env.DB_TYPE || 'postgres') as 'postgres' | 'sqlite',
  sqlitePath: process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'user.sqlite'),
};
