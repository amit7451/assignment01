export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    correlationId?: string;
    [key: string]: any;
  };
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

export interface AuthResponse {
  user: UserDto;
  tokens: AuthTokens;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: string;
}

export type NotificationType =
  | 'WELCOME_EMAIL'
  | 'SECURITY_ALERT'
  | 'PROFILE_UPDATED'
  | 'ACCOUNT_DELETED';

export type NotificationStatus =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'DEAD_LETTER';

export type NotificationChannel = 'EMAIL' | 'IN_APP' | 'SMS';

export interface NotificationRecord {
  id: string;
  eventId: string;
  userId: string;
  recipient: string;
  type: NotificationType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  status: NotificationStatus;
  attemptCount: number;
  errorMessage?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  sentAt?: string | null;
}

export interface DeadLetterRecord {
  id: string;
  eventId: string;
  subject: string;
  payload: string;
  reason: string;
  attempts: number;
  failedAt: string;
}
