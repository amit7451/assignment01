export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerOptions {
  serviceName: string;
  minLevel?: LogLevel;
}

export class Logger {
  private serviceName: string;
  private minLevel: LogLevel;

  constructor(options: LoggerOptions) {
    this.serviceName = options.serviceName;
    const envLevel = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel;
    this.minLevel = LOG_LEVELS[envLevel] !== undefined ? envLevel : (options.minLevel || 'info');
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, any>): string {
    const isProd = process.env.NODE_ENV === 'production';
    const timestamp = new Date().toISOString();

    if (isProd) {
      return JSON.stringify({
        timestamp,
        level: level.toUpperCase(),
        service: this.serviceName,
        message,
        ...meta,
      });
    }

    const colorMap: Record<LogLevel, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    const color = colorMap[level];
    const correlationStr = meta?.correlationId ? ` [cid:${meta.correlationId}]` : '';
    const metaStr = meta && Object.keys(meta).length > (meta.correlationId ? 1 : 0)
      ? ` | ${JSON.stringify(meta)}`
      : '';

    return `[${timestamp}] ${color}[${level.toUpperCase()}]${reset} [${this.serviceName}]${correlationStr} ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }

  child(additionalMeta: Record<string, any>): LoggerChild {
    return new LoggerChild(this, additionalMeta);
  }
}

export class LoggerChild {
  constructor(private parent: Logger, private meta: Record<string, any>) {}

  debug(message: string, extra?: Record<string, any>): void {
    this.parent.debug(message, { ...this.meta, ...extra });
  }

  info(message: string, extra?: Record<string, any>): void {
    this.parent.info(message, { ...this.meta, ...extra });
  }

  warn(message: string, extra?: Record<string, any>): void {
    this.parent.warn(message, { ...this.meta, ...extra });
  }

  error(message: string, extra?: Record<string, any>): void {
    this.parent.error(message, { ...this.meta, ...extra });
  }
}
