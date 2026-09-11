import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  Logger,
  UserDto,
  AuthResponse,
  AuthTokenPayload,
  EventSubjects,
  UserRegisteredEvent,
  UserPasswordChangedEvent,
  UserProfileUpdatedEvent,
  UserDeletedEvent,
} from '@system/shared';
import { IUserRepository, UserEntity } from '../db/database';
import { NatsPublisher } from '../events/natsPublisher';
import { config } from '../config';

const logger = new Logger({ serviceName: 'user-service' });

export class UserService {
  constructor(
    private userRepository: IUserRepository,
    private publisher: NatsPublisher
  ) {}

  private mapUserDto(user: UserEntity): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private generateTokens(user: UserEntity): { accessToken: string; tokenType: 'Bearer'; expiresIn: string } {
    const payload: AuthTokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: config.jwtExpiresIn,
    };
  }

  async register(
    data: { email: string; password: string; name: string; role?: string },
    correlationId: string
  ): Promise<AuthResponse> {
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) {
      const error: any = new Error('User with this email already exists');
      error.statusCode = 409;
      error.code = 'USER_ALREADY_EXISTS';
      throw error;
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(data.password, saltRounds);
    const userId = uuidv4();

    const createdUser = await this.userRepository.createUser({
      id: userId,
      email: data.email,
      passwordHash,
      name: data.name,
      role: data.role || 'user',
    });

    const userDto = this.mapUserDto(createdUser);
    const tokens = this.generateTokens(createdUser);

    // Construct and publish domain event
    const event: UserRegisteredEvent = {
      metadata: {
        eventId: uuidv4(),
        eventType: EventSubjects.USER_REGISTERED,
        aggregateId: createdUser.id,
        timestamp: new Date().toISOString(),
        version: '1.0',
        correlationId,
        producer: 'user-service',
      },
      payload: {
        userId: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        registeredAt: createdUser.createdAt.toISOString(),
      },
    };

    // Asynchronous publication
    this.publisher.publish(EventSubjects.USER_REGISTERED, event).catch((err) => {
      logger.error('Failed to publish user.registered event to NATS', {
        error: err.message,
        userId: createdUser.id,
        correlationId,
      });
    });

    return { user: userDto, tokens };
  }

  async login(
    data: { email: string; password: string },
    correlationId: string
  ): Promise<AuthResponse> {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) {
      const error: any = new Error('Invalid email or password');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    const isMatch = await bcrypt.compare(data.password, user.passwordHash);
    if (!isMatch) {
      const error: any = new Error('Invalid email or password');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    const userDto = this.mapUserDto(user);
    const tokens = this.generateTokens(user);

    logger.info('User logged in successfully', {
      userId: user.id,
      email: user.email,
      correlationId,
    });

    return { user: userDto, tokens };
  }

  async getProfile(userId: string): Promise<UserDto> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      const error: any = new Error('User not found');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }
    return this.mapUserDto(user);
  }

  async updateProfile(
    userId: string,
    updates: { name?: string },
    correlationId: string
  ): Promise<UserDto> {
    const updated = await this.userRepository.updateProfile(userId, updates);
    if (!updated) {
      const error: any = new Error('User not found');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const userDto = this.mapUserDto(updated);

    const event: UserProfileUpdatedEvent = {
      metadata: {
        eventId: uuidv4(),
        eventType: EventSubjects.USER_PROFILE_UPDATED,
        aggregateId: updated.id,
        timestamp: new Date().toISOString(),
        version: '1.0',
        correlationId,
        producer: 'user-service',
      },
      payload: {
        userId: updated.id,
        email: updated.email,
        name: updated.name,
        updatedFields: Object.keys(updates),
        updatedAt: updated.updatedAt.toISOString(),
      },
    };

    this.publisher.publish(EventSubjects.USER_PROFILE_UPDATED, event).catch((err) => {
      logger.error('Failed to publish user.profile_updated event to NATS', {
        error: err.message,
        userId: updated.id,
        correlationId,
      });
    });

    return userDto;
  }

  async changePassword(
    userId: string,
    data: { currentPassword: string; newPassword: string },
    correlationId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      const error: any = new Error('User not found');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const isMatch = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!isMatch) {
      const error: any = new Error('Current password does not match');
      error.statusCode = 400;
      error.code = 'INCORRECT_CURRENT_PASSWORD';
      throw error;
    }

    const newHash = await bcrypt.hash(data.newPassword, 12);
    await this.userRepository.updatePassword(userId, newHash);

    // Emits security alert event
    const event: UserPasswordChangedEvent = {
      metadata: {
        eventId: uuidv4(),
        eventType: EventSubjects.USER_PASSWORD_CHANGED,
        aggregateId: user.id,
        timestamp: new Date().toISOString(),
        version: '1.0',
        correlationId,
        producer: 'user-service',
      },
      payload: {
        userId: user.id,
        email: user.email,
        name: user.name,
        changedAt: new Date().toISOString(),
        ipAddress,
        userAgent,
      },
    };

    this.publisher.publish(EventSubjects.USER_PASSWORD_CHANGED, event).catch((err) => {
      logger.error('Failed to publish user.password_changed event to NATS', {
        error: err.message,
        userId: user.id,
        correlationId,
      });
    });

    return { message: 'Password updated successfully' };
  }

  async deleteUser(userId: string, correlationId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      const error: any = new Error('User not found');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const deleted = await this.userRepository.deleteUser(userId);
    if (deleted) {
      const event: UserDeletedEvent = {
        metadata: {
          eventId: uuidv4(),
          eventType: EventSubjects.USER_DELETED,
          aggregateId: user.id,
          timestamp: new Date().toISOString(),
          version: '1.0',
          correlationId,
          producer: 'user-service',
        },
        payload: {
          userId: user.id,
          email: user.email,
          deletedAt: new Date().toISOString(),
        },
      };

      this.publisher.publish(EventSubjects.USER_DELETED, event).catch((err) => {
        logger.error('Failed to publish user.deleted event to NATS', {
          error: err.message,
          userId: user.id,
          correlationId,
        });
      });
    }

    return deleted;
  }
}
