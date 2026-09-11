import { z } from 'zod';

export const NATS_STREAM_NAME = 'USER_EVENTS';

export const EventSubjects = {
  USER_REGISTERED: 'user.registered',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_DELETED: 'user.deleted',
} as const;

export type EventSubject = typeof EventSubjects[keyof typeof EventSubjects];

export interface EventMetadata {
  eventId: string;
  eventType: string;
  aggregateId: string;
  timestamp: string;
  version: string;
  correlationId: string;
  producer: string;
}

export interface DomainEvent<T = any> {
  metadata: EventMetadata;
  payload: T;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------
export interface UserRegisteredPayload {
  userId: string;
  email: string;
  name: string;
  registeredAt: string;
}

export interface UserPasswordChangedPayload {
  userId: string;
  email: string;
  name: string;
  changedAt: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UserProfileUpdatedPayload {
  userId: string;
  email: string;
  name: string;
  updatedFields: string[];
  updatedAt: string;
}

export interface UserDeletedPayload {
  userId: string;
  email: string;
  deletedAt: string;
}

// ---------------------------------------------------------------------------
// Typed Domain Events
// ---------------------------------------------------------------------------
export type UserRegisteredEvent = DomainEvent<UserRegisteredPayload>;
export type UserPasswordChangedEvent = DomainEvent<UserPasswordChangedPayload>;
export type UserProfileUpdatedEvent = DomainEvent<UserProfileUpdatedPayload>;
export type UserDeletedEvent = DomainEvent<UserDeletedPayload>;

// ---------------------------------------------------------------------------
// Zod Schemas for Runtime Validation
// ---------------------------------------------------------------------------
export const EventMetadataSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string(),
  aggregateId: z.string(),
  timestamp: z.string().datetime(),
  version: z.string(),
  correlationId: z.string(),
  producer: z.string(),
});

export const UserRegisteredPayloadSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  registeredAt: z.string().datetime(),
});

export const UserPasswordChangedPayloadSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  changedAt: z.string().datetime(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export const UserProfileUpdatedPayloadSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  updatedFields: z.array(z.string()),
  updatedAt: z.string().datetime(),
});

export const UserDeletedPayloadSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  deletedAt: z.string().datetime(),
});
