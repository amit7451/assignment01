import { Pool, PoolClient } from 'pg';
import { Logger } from '@system/shared';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

const logger = new Logger({ serviceName: 'user-service' });

export interface UserEntity {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserRepository {
  init(): Promise<void>;
  createUser(user: { id: string; email: string; passwordHash: string; name: string; role?: string }): Promise<UserEntity>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findById(id: string): Promise<UserEntity | null>;
  updateProfile(id: string, updates: { name?: string }): Promise<UserEntity | null>;
  updatePassword(id: string, newPasswordHash: string): Promise<UserEntity | null>;
  deleteUser(id: string): Promise<boolean>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// PostgreSQL Implementation
// ---------------------------------------------------------------------------
export class PostgresUserRepository implements IUserRepository {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5000,
      max: 20,
      idleTimeoutMillis: 30000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
    });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(36) PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'user' NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
      logger.info('PostgreSQL user table initialized successfully');
    } finally {
      client.release();
    }
  }

  async createUser(user: { id: string; email: string; passwordHash: string; name: string; role?: string }): Promise<UserEntity> {
    const query = `
      INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, email, password_hash, name, role, created_at, updated_at;
    `;
    const values = [user.id, user.email.toLowerCase().trim(), user.passwordHash, user.name.trim(), user.role || 'user'];
    const result = await this.pool.query(query, values);
    const row = result.rows[0];
    return this.mapRow(row);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const query = `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;`;
    const result = await this.pool.query(query, [email.trim()]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<UserEntity | null> {
    const query = `SELECT * FROM users WHERE id = $1 LIMIT 1;`;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async updateProfile(id: string, updates: { name?: string }): Promise<UserEntity | null> {
    const query = `
      UPDATE users
      SET name = COALESCE($1, name),
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const result = await this.pool.query(query, [updates.name, id]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async updatePassword(id: string, newPasswordHash: string): Promise<UserEntity | null> {
    const query = `
      UPDATE users
      SET password_hash = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const result = await this.pool.query(query, [newPasswordHash, id]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM users WHERE id = $1;`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1;');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapRow(row: any): UserEntity {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
      role: row.role,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// ---------------------------------------------------------------------------
// Resilient Embedded / In-Memory Fallback Implementation
// ---------------------------------------------------------------------------
export class MemoryUserRepository implements IUserRepository {
  private users: Map<string, UserEntity> = new Map();
  private storageFile: string | null = null;

  constructor(filePath?: string) {
    if (filePath) {
      this.storageFile = filePath;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async init(): Promise<void> {
    if (this.storageFile && fs.existsSync(this.storageFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
        for (const item of data) {
          this.users.set(item.id, {
            ...item,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          });
        }
        logger.info(`Loaded ${this.users.size} users from embedded store`);
      } catch (err: any) {
        logger.warn('Failed to load embedded store file, starting fresh', { error: err.message });
      }
    }
  }

  private persist(): void {
    if (this.storageFile) {
      try {
        const arr = Array.from(this.users.values());
        fs.writeFileSync(this.storageFile, JSON.stringify(arr, null, 2), 'utf8');
      } catch (err: any) {
        logger.error('Failed to persist user store file', { error: err.message });
      }
    }
  }

  async createUser(user: { id: string; email: string; passwordHash: string; name: string; role?: string }): Promise<UserEntity> {
    const existing = await this.findByEmail(user.email);
    if (existing) {
      const err: any = new Error('duplicate key value violates unique constraint "users_email_key"');
      err.code = '23505';
      throw err;
    }

    const now = new Date();
    const entity: UserEntity = {
      id: user.id,
      email: user.email.toLowerCase().trim(),
      passwordHash: user.passwordHash,
      name: user.name.trim(),
      role: user.role || 'user',
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(entity.id, entity);
    this.persist();
    return entity;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const cleanEmail = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email === cleanEmail) return u;
    }
    return null;
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.users.get(id) || null;
  }

  async updateProfile(id: string, updates: { name?: string }): Promise<UserEntity | null> {
    const user = this.users.get(id);
    if (!user) return null;
    if (updates.name !== undefined) {
      user.name = updates.name.trim();
    }
    user.updatedAt = new Date();
    this.users.set(id, user);
    this.persist();
    return user;
  }

  async updatePassword(id: string, newPasswordHash: string): Promise<UserEntity | null> {
    const user = this.users.get(id);
    if (!user) return null;
    user.passwordHash = newPasswordHash;
    user.updatedAt = new Date();
    this.users.set(id, user);
    this.persist();
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    const deleted = this.users.delete(id);
    if (deleted) this.persist();
    return deleted;
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.persist();
  }
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------
export async function createDatabaseRepository(): Promise<IUserRepository> {
  if (config.dbType === 'postgres') {
    try {
      const repo = new PostgresUserRepository(config.databaseUrl);
      await repo.init();
      logger.info('Connected to PostgreSQL database');
      return repo;
    } catch (err: any) {
      logger.warn(`PostgreSQL unavailable (${err.message}). Falling back to embedded persistent storage.`);
      const fallbackRepo = new MemoryUserRepository(config.sqlitePath);
      await fallbackRepo.init();
      return fallbackRepo;
    }
  }

  logger.info('Using embedded persistent user repository');
  const repo = new MemoryUserRepository(config.sqlitePath);
  await repo.init();
  return repo;
}
