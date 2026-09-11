import { v4 as uuidv4 } from 'uuid';
import {
  Logger,
  DomainEvent,
  EventSubjects,
  NotificationRecord,
  UserRegisteredPayload,
  UserPasswordChangedPayload,
  UserProfileUpdatedPayload,
  UserDeletedPayload,
} from '@system/shared';
import { INotificationRepository } from '../db/notificationRepository';
import { IEmailProvider, EmailTemplateEngine } from '../providers/emailProvider';

const logger = new Logger({ serviceName: 'notification-service' });

export class NotificationHandler {
  constructor(
    private repository: INotificationRepository,
    private emailProvider: IEmailProvider
  ) {}

  async handleEvent(event: DomainEvent): Promise<void> {
    const { eventId, eventType, correlationId } = event.metadata;

    logger.info(`Received event [${eventType}] with eventId: ${eventId}`, {
      eventId,
      eventType,
      correlationId,
    });

    // 1. Idempotency check: Guarantee exactly-once delivery side effects
    const alreadyProcessed = await this.repository.isEventProcessed(eventId);
    if (alreadyProcessed) {
      logger.warn(`Idempotency trigger: Event ${eventId} was already processed. Ignoring duplicate.`, {
        eventId,
        eventType,
        correlationId,
      });
      return;
    }

    const notificationId = uuidv4();
    const now = new Date().toISOString();

    let notificationRecord: NotificationRecord | null = null;

    try {
      switch (eventType) {
        case EventSubjects.USER_REGISTERED: {
          const p = event.payload as UserRegisteredPayload;
          const { subject, text, html } = EmailTemplateEngine.welcomeEmail(p.name, p.email);

          await this.emailProvider.sendEmail({
            to: p.email,
            subject,
            text,
            html,
            correlationId,
          });

          notificationRecord = {
            id: notificationId,
            eventId,
            userId: p.userId,
            recipient: p.email,
            type: 'WELCOME_EMAIL',
            channel: 'EMAIL',
            subject,
            body: text,
            status: 'SENT',
            attemptCount: 1,
            createdAt: now,
            sentAt: new Date().toISOString(),
          };
          break;
        }

        case EventSubjects.USER_PASSWORD_CHANGED: {
          const p = event.payload as UserPasswordChangedPayload;
          const { subject, text, html } = EmailTemplateEngine.securityAlertPasswordChanged(
            p.name,
            p.email,
            p.changedAt,
            p.ipAddress
          );

          await this.emailProvider.sendEmail({
            to: p.email,
            subject,
            text,
            html,
            correlationId,
          });

          notificationRecord = {
            id: notificationId,
            eventId,
            userId: p.userId,
            recipient: p.email,
            type: 'SECURITY_ALERT',
            channel: 'EMAIL',
            subject,
            body: text,
            status: 'SENT',
            attemptCount: 1,
            metadata: { ipAddress: p.ipAddress, userAgent: p.userAgent },
            createdAt: now,
            sentAt: new Date().toISOString(),
          };
          break;
        }

        case EventSubjects.USER_PROFILE_UPDATED: {
          const p = event.payload as UserProfileUpdatedPayload;
          const { subject, text, html } = EmailTemplateEngine.profileUpdatedEmail(
            p.name,
            p.email,
            p.updatedFields,
            p.updatedAt
          );

          await this.emailProvider.sendEmail({
            to: p.email,
            subject,
            text,
            html,
            correlationId,
          });

          notificationRecord = {
            id: notificationId,
            eventId,
            userId: p.userId,
            recipient: p.email,
            type: 'PROFILE_UPDATED',
            channel: 'EMAIL',
            subject,
            body: text,
            status: 'SENT',
            attemptCount: 1,
            metadata: { updatedFields: p.updatedFields },
            createdAt: now,
            sentAt: new Date().toISOString(),
          };
          break;
        }

        case EventSubjects.USER_DELETED: {
          const p = event.payload as UserDeletedPayload;
          const { subject, text, html } = EmailTemplateEngine.accountDeletedEmail(p.email, p.deletedAt);

          await this.emailProvider.sendEmail({
            to: p.email,
            subject,
            text,
            html,
            correlationId,
          });

          notificationRecord = {
            id: notificationId,
            eventId,
            userId: p.userId,
            recipient: p.email,
            type: 'ACCOUNT_DELETED',
            channel: 'EMAIL',
            subject,
            body: text,
            status: 'SENT',
            attemptCount: 1,
            createdAt: now,
            sentAt: new Date().toISOString(),
          };
          break;
        }

        default:
          logger.warn(`Unknown event type received: ${eventType}`, { eventId, correlationId });
          break;
      }

      // Save notification audit log
      if (notificationRecord) {
        await this.repository.saveNotification(notificationRecord);
      }

      // Mark event as processed in idempotency ledger
      await this.repository.recordEventProcessed(eventId, eventType);

      logger.info(`Successfully processed event ${eventId} (${eventType})`, {
        eventId,
        eventType,
        correlationId,
      });
    } catch (err: any) {
      logger.error(`Error processing notification for event ${eventId}: ${err.message}`, {
        eventId,
        eventType,
        correlationId,
        stack: err.stack,
      });

      // Save failed notification record for audit trail
      if (notificationRecord) {
        notificationRecord.status = 'FAILED';
        notificationRecord.errorMessage = err.message;
        await this.repository.saveNotification(notificationRecord);
      }

      throw err; // Re-throw to allow NATS consumer retry or DLQ routing
    }
  }
}
