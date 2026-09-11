import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  Consumer,
  StringCodec,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
} from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { Logger, DomainEvent } from '@system/shared';
import { config } from '../config';
import { NotificationHandler } from '../handlers/notificationHandler';
import { INotificationRepository } from '../db/notificationRepository';

const logger = new Logger({ serviceName: 'notification-service' });
const sc = StringCodec();

export class NatsConsumer {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private consumer: Consumer | null = null;
  private isRunning = false;
  private isConnected = false;

  constructor(
    private handler: NotificationHandler,
    private repository: INotificationRepository
  ) {}

  async start(): Promise<void> {
    const connectionOptions: any = {
      servers: config.natsUrl,
      name: 'notification-service-consumer',
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

    logger.info('Connected to NATS broker');

    // Monitor connection lifecycle
    (async () => {
      if (!this.nc) return;
      for await (const status of this.nc.status()) {
        logger.info(`NATS consumer connection status: ${status.type}`, { data: status.data });
      }
    })().catch((err) => {
      logger.error('NATS status loop error', { error: err.message });
    });

    // Ensure consumer exists and start message loop
    await this.setupConsumer();
    this.startMessageLoop();
  }

  private async setupConsumer(): Promise<void> {
    if (!this.nc) return;
    const jsm: JetStreamManager = await this.nc.jetstreamManager();

    // Verify stream exists or wait for it
    let streamFound = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const streamInfo = await jsm.streams.info(config.streamName);
        if (streamInfo) {
          streamFound = true;
          break;
        }
      } catch (err: any) {
        logger.info(`Waiting for stream "${config.streamName}" to be initialized... (attempt ${attempt}/10)`);
        await new Promise((res) => setTimeout(res, 2000));
      }
    }

    if (!streamFound) {
      // Auto-create stream if publisher hasn't created it yet
      try {
        await jsm.streams.add({
          name: config.streamName,
          subjects: ['user.*'],
        });
        logger.info(`Created missing JetStream stream "${config.streamName}" from notification service`);
      } catch (err: any) {
        logger.warn(`Could not create stream: ${err.message}. Will attempt consumer binding directly.`);
      }
    }

    // Configure Durable Pull Consumer
    try {
      await jsm.consumers.add(config.streamName, {
        durable_name: config.consumerDurableName,
        filter_subject: 'user.*',
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        replay_policy: ReplayPolicy.Instant,
        max_deliver: 5,
        ack_wait: 10 * 1000 * 1000 * 1000, // 10s in nanoseconds
      });
      logger.info(`Durable JetStream consumer "${config.consumerDurableName}" registered on stream "${config.streamName}"`);
    } catch (err: any) {
      logger.info(`Consumer already exists or updated: ${err.message}`);
    }

    if (this.js) {
      this.consumer = await this.js.consumers.get(config.streamName, config.consumerDurableName);
      logger.info(`Successfully bound to JetStream consumer: ${config.consumerDurableName}`);
    }
  }

  private async startMessageLoop(): Promise<void> {
    if (!this.consumer) {
      logger.error('Cannot start message loop: consumer is null');
      return;
    }

    this.isRunning = true;
    logger.info('NATS JetStream message consumption loop started');

    (async () => {
      while (this.isRunning && this.consumer) {
        try {
          // Fetch batch of messages with timeout
          const messages = await this.consumer.fetch({ max_messages: 10, expires: 5000 });
          for await (const msg of messages) {
            await this.processMessage(msg);
          }
        } catch (err: any) {
          if (err.message && err.message.includes('timeout')) {
            // Heartbeat / idle timeout is normal
            continue;
          }
          if (!this.isRunning) break;
          logger.warn(`Error during consumer fetch: ${err.message}. Retrying in 2s...`);
          await new Promise((res) => setTimeout(res, 2000));
        }
      }
    })().catch((err) => {
      logger.error('Fatal error in consumer message loop', { error: err.message });
    });
  }

  private async processMessage(msg: any): Promise<void> {
    const rawPayload = sc.decode(msg.data);
    const deliveryCount = msg.info?.deliveryCount || 1;
    const subject = msg.subject;

    let event: DomainEvent;
    try {
      event = JSON.parse(rawPayload);
    } catch (parseErr: any) {
      logger.error('Failed to parse event JSON, sending to DLQ and terminating message', {
        subject,
        rawPayload,
        error: parseErr.message,
      });

      await this.repository.saveDeadLetter({
        id: uuidv4(),
        eventId: 'unknown',
        subject,
        payload: rawPayload,
        reason: `JSON parse error: ${parseErr.message}`,
        attempts: deliveryCount,
        failedAt: new Date().toISOString(),
      });

      msg.term();
      return;
    }

    // Check for poison message threshold
    if (deliveryCount > 5) {
      logger.error(`Message ${event.metadata?.eventId} exceeded max delivery attempts (${deliveryCount}). Routing to Dead Letter Queue.`, {
        eventId: event.metadata?.eventId,
        subject,
        deliveryCount,
      });

      await this.repository.saveDeadLetter({
        id: uuidv4(),
        eventId: event.metadata?.eventId || 'unknown',
        subject,
        payload: rawPayload,
        reason: `Max delivery attempts exceeded (${deliveryCount})`,
        attempts: deliveryCount,
        failedAt: new Date().toISOString(),
      });

      // Terminate message so it is removed from consumer redelivery
      msg.term();
      return;
    }

    try {
      await this.handler.handleEvent(event);
      // Explicit acknowledgement to NATS broker
      msg.ack();
    } catch (handleErr: any) {
      logger.warn(`Handler failed for event ${event.metadata?.eventId} (attempt ${deliveryCount}/5): ${handleErr.message}`);

      // Calculate exponential backoff delay before redelivery
      const backoffMs = Math.min(1000 * Math.pow(2, deliveryCount - 1), 10000);
      msg.nak(backoffMs);
    }
  }

  isHealthy(): boolean {
    return this.isConnected && this.nc !== null && !this.nc.isClosed();
  }

  async stop(): Promise<void> {
    logger.info('Stopping NATS consumer...');
    this.isRunning = false;
    if (this.nc) {
      try {
        await this.nc.drain();
      } catch (err: any) {
        logger.warn('Error while draining NATS connection', { error: err.message });
      }
      await this.nc.close();
      this.isConnected = false;
      this.nc = null;
      this.js = null;
      this.consumer = null;
      logger.info('NATS consumer stopped');
    }
  }
}
