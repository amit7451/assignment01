import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  StringCodec,
  headers,
  StorageType,
  RetentionPolicy,
} from 'nats';
import { Logger, DomainEvent, NATS_STREAM_NAME } from '@system/shared';
import { config } from '../config';

const logger = new Logger({ serviceName: 'user-service' });
const sc = StringCodec();

export class NatsPublisher {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private isConnected = false;

  async connect(): Promise<void> {
    try {
      const connectionOptions: any = {
        servers: config.natsUrl,
        name: 'user-service-publisher',
        maxReconnectAttempts: -1,
        reconnectTimeWait: 2000,
      };

      if (config.natsToken) {
        connectionOptions.token = config.natsToken;
      } else if (config.natsUser && config.natsPassword) {
        connectionOptions.user = config.natsUser;
        connectionOptions.pass = config.natsPassword;
      }

      logger.info(`Connecting to NATS at ${config.natsUrl}...`);
      this.nc = await connect(connectionOptions);
      this.isConnected = true;
      this.js = this.nc.jetstream();

      // Monitor connection lifecycle
      (async () => {
        if (!this.nc) return;
        for await (const status of this.nc.status()) {
          logger.info(`NATS connection status: ${status.type}`, { data: status.data });
        }
      })().catch((err) => {
        logger.error('NATS status loop error', { error: err.message });
      });

      logger.info('Connected to NATS broker');

      // Initialize JetStream Stream
      await this.ensureStream();
    } catch (err: any) {
      logger.error('Failed to connect to NATS broker', { error: err.message });
      this.isConnected = false;
      throw err;
    }
  }

  private async ensureStream(): Promise<void> {
    if (!this.nc) return;
    try {
      const jsm: JetStreamManager = await this.nc.jetstreamManager();
      const streams = await jsm.streams.list().next();
      const streamExists = streams.some((s) => s.config.name === NATS_STREAM_NAME);

      const streamConfig = {
        name: NATS_STREAM_NAME,
        subjects: ['user.*'],
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        max_age: 7 * 24 * 60 * 60 * 1000 * 1000 * 1000, // 7 days in nanoseconds
        duplicate_window: 24 * 60 * 60 * 1000 * 1000 * 1000, // 24 hours deduplication window
      };

      if (!streamExists) {
        await jsm.streams.add(streamConfig);
        logger.info(`JetStream stream "${NATS_STREAM_NAME}" created with subjects: user.*`);
      } else {
        await jsm.streams.update(NATS_STREAM_NAME, streamConfig);
        logger.info(`JetStream stream "${NATS_STREAM_NAME}" verified and updated`);
      }
    } catch (err: any) {
      // If File storage fails in restricted environments, attempt Memory storage
      try {
        const jsm: JetStreamManager = await this.nc.jetstreamManager();
        await jsm.streams.add({
          name: NATS_STREAM_NAME,
          subjects: ['user.*'],
          storage: StorageType.Memory,
          retention: RetentionPolicy.Limits,
          duplicate_window: 24 * 60 * 60 * 1000 * 1000 * 1000,
        });
        logger.info(`JetStream stream "${NATS_STREAM_NAME}" created with Memory storage`);
      } catch (innerErr: any) {
        logger.warn(`Could not verify/create stream directly (might be managed externally): ${innerErr.message}`);
      }
    }
  }

  async publish<T>(subject: string, event: DomainEvent<T>): Promise<void> {
    if (!this.js || !this.isConnected) {
      throw new Error('NATS publisher is not connected');
    }

    const payloadBytes = sc.encode(JSON.stringify(event));
    const h = headers();
    // NATS deduplication header:
    h.set('Nats-Msg-Id', event.metadata.eventId);
    h.set('X-Correlation-Id', event.metadata.correlationId);
    h.set('X-Event-Type', event.metadata.eventType);
    h.set('X-Timestamp', event.metadata.timestamp);
    h.set('X-Producer', event.metadata.producer);

    try {
      const pubAck = await this.js.publish(subject, payloadBytes, {
        headers: h,
        msgID: event.metadata.eventId,
      });

      logger.info(`Published event to [${subject}]`, {
        eventId: event.metadata.eventId,
        eventType: event.metadata.eventType,
        correlationId: event.metadata.correlationId,
        seq: pubAck.seq,
        stream: pubAck.stream,
        duplicate: pubAck.duplicate,
      });
    } catch (err: any) {
      logger.error(`Failed to publish event to [${subject}]`, {
        eventId: event.metadata.eventId,
        error: err.message,
        correlationId: event.metadata.correlationId,
      });
      throw err;
    }
  }

  isHealthy(): boolean {
    return this.isConnected && this.nc !== null && !this.nc.isClosed();
  }

  async close(): Promise<void> {
    if (this.nc) {
      logger.info('Draining and closing NATS connection...');
      try {
        await this.nc.drain();
      } catch (err: any) {
        logger.warn('Error during NATS drain', { error: err.message });
      }
      await this.nc.close();
      this.isConnected = false;
      this.nc = null;
      this.js = null;
    }
  }
}
