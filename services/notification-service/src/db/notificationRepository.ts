import { Pool } from 'pg';
import { Logger, NotificationRecord, DeadLetterRecord } from '@system/shared';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

const logger = new Logger({ serviceName: 'notification-service' });

export interface INotificationRepository {
  init(): Promise<void>;
  isEventProcessed(eventId: string): Promise<boolean>;
  recordEventProcessed(eventId: string, eventType: string): Promise<void>;
  saveNotification(record: NotificationRecord): Promise<void>;
  getNotifications(limit?: number, userId?: string): Promise<NotificationRecord[]>;
  saveDeadLetter(record: DeadLetterRecord): Promise<void>;
  getDeadLetters(limit?: number): Promise<DeadLetterRecord[]>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// PostgreSQL Implementation
// ---------------------------------------------------------------------------
export class PostgresNotificationRepository implements INotificationRepository {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5000,
      max: 20,
      idleTimeoutMillis: 30000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client (notifications)', { error: err.message });
    });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Idempotency ledger table
      await client.query(`
        CREATE TABLE IF NOT EXISTS processed_events (
          event_id VARCHAR(64) PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);

      // Notification history table
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id VARCHAR(64) PRIMARY KEY,
          event_id VARCHAR(64) NOT NULL,
          user_id VARCHAR(64) NOT NULL,
          recipient VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
          channel VARCHAR(50) NOT NULL,
          subject VARCHAR(255) NOT NULL,
          body TEXT NOT NULL,
          status VARCHAR(50) NOT NULL,
          attempt_count INT DEFAULT 1 NOT NULL,
          error_message TEXT,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
      `);

      // Dead letter table
      await client.query(`
        CREATE TABLE IF NOT EXISTS dead_letters (
          id VARCHAR(64) PRIMARY KEY,
          event_id VARCHAR(64) NOT NULL,
          subject VARCHAR(100) NOT NULL,
          payload TEXT NOT NULL,
          reason TEXT NOT NULL,
          attempts INT NOT NULL,
          failed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);

      logger.info('PostgreSQL notification tables initialized successfully');
    } finally {
      client.release();
    }
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    const query = `SELECT 1 FROM processed_events WHERE event_id = $1 LIMIT 1;`;
    const res = await this.pool.query(query, [eventId]);
    return res.rows.length > 0;
  }

  async recordEventProcessed(eventId: string, eventType: string): Promise<void> {
    const query = `
      INSERT INTO processed_events (event_id, event_type, processed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (event_id) DO NOTHING;
    `;
    await this.pool.query(query, [eventId, eventType]);
  }

  async saveNotification(record: NotificationRecord): Promise<void> {
    const query = `
      INSERT INTO notifications (
        id, event_id, user_id, recipient, type, channel,
        subject, body, status, attempt_count, error_message,
        metadata, created_at, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        attempt_count = EXCLUDED.attempt_count,
        error_message = EXCLUDED.error_message,
        sent_at = EXCLUDED.sent_at;
    `;
    const values = [
      record.id,
      record.eventId,
      record.userId,
      record.recipient,
      record.type,
      record.channel,
      record.subject,
      record.body,
      record.status,
      record.attemptCount,
      record.errorMessage || null,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.createdAt,
      record.sentAt || null,
    ];
    await this.pool.query(query, values);
  }

  async getNotifications(limit = 50, userId?: string): Promise<NotificationRecord[]> {
    let query = `SELECT * FROM notifications`;
    const params: any[] = [];

    if (userId) {
      query += ` WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2;`;
      params.push(userId, limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $1;`;
      params.push(limit);
    }

    const res = await this.pool.query(query, params);
    return res.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      userId: row.user_id,
      recipient: row.recipient,
      type: row.type,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      status: row.status,
      attemptCount: row.attempt_count,
      errorMessage: row.error_message,
      metadata: row.metadata,
      createdAt: new Date(row.created_at).toISOString(),
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    }));
  }

  async saveDeadLetter(record: DeadLetterRecord): Promise<void> {
    const query = `
      INSERT INTO dead_letters (id, event_id, subject, payload, reason, attempts, failed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `;
    await this.pool.query(query, [
      record.id,
      record.eventId,
      record.subject,
      record.payload,
      record.reason,
      record.attempts,
      record.failedAt,
    ]);
  }

  async getDeadLetters(limit = 50): Promise<DeadLetterRecord[]> {
    const query = `SELECT * FROM dead_letters ORDER BY failed_at DESC LIMIT $1;`;
    const res = await this.pool.query(query, [limit]);
    return res.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      subject: row.subject,
      payload: row.payload,
      reason: row.reason,
      attempts: row.attempts,
      failedAt: new Date(row.failed_at).toISOString(),
    }));
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
}

// ---------------------------------------------------------------------------
// Resilient Embedded / In-Memory Fallback Implementation
// ---------------------------------------------------------------------------
export class MemoryNotificationRepository implements INotificationRepository {
  private processedEvents = new Set<string>();
  private notifications = new Map<string, NotificationRecord>();
  private deadLetters: DeadLetterRecord[] = [];
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
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const parsed = JSON.parse(raw);
        (parsed.processedEvents || []).forEach((id: string) => this.processedEvents.add(id));
        (parsed.notifications || []).forEach((n: NotificationRecord) => this.notifications.set(n.id, n));
        this.deadLetters = parsed.deadLetters || [];
        logger.info(`Loaded ${this.notifications.size} notifications from embedded store`);
      } catch (err: any) {
        logger.warn('Failed to load embedded store, starting fresh', { error: err.message });
      }
    }
  }

  private persist(): void {
    if (this.storageFile) {
      try {
        const payload = {
          processedEvents: Array.from(this.processedEvents),
          notifications: Array.from(this.notifications.values()),
          deadLetters: this.deadLetters,
        };
        fs.writeFileSync(this.storageFile, JSON.stringify(payload, null, 2), 'utf8');
      } catch (err: any) {
        logger.error('Failed to persist notification store', { error: err.message });
      }
    }
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async recordEventProcessed(eventId: string, _eventType: string): Promise<void> {
    this.processedEvents.add(eventId);
    this.persist();
  }

  async saveNotification(record: NotificationRecord): Promise<void> {
    this.notifications.set(record.id, record);
    this.persist();
  }

  async getNotifications(limit = 50, userId?: string): Promise<NotificationRecord[]> {
    let list = Array.from(this.notifications.values());
    if (userId) {
      list = list.filter((n) => n.userId === userId);
    }
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list.slice(0, limit);
  }

  async saveDeadLetter(record: DeadLetterRecord): Promise<void> {
    this.deadLetters.unshift(record);
    this.persist();
  }

  async getDeadLetters(limit = 50): Promise<DeadLetterRecord[]> {
    return this.deadLetters.slice(0, limit);
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
export async function createNotificationRepository(): Promise<INotificationRepository> {
  if (config.dbType === 'postgres') {
    try {
      const repo = new PostgresNotificationRepository(config.databaseUrl);
      await repo.init();
      logger.info('Connected to PostgreSQL notification database');
      return repo;
    } catch (err: any) {
      logger.warn(`PostgreSQL unavailable for notifications (${err.message}). Falling back to embedded store.`);
      const fallbackRepo = new MemoryNotificationRepository(config.sqlitePath);
      await fallbackRepo.init();
      return fallbackRepo;
    }
  }

  logger.info('Using embedded persistent notification repository');
  const repo = new MemoryNotificationRepository(config.sqlitePath);
  await repo.init();
  return repo;
}
