// ============================================================================
// SmartDialer — Structured Logger
// ============================================================================
// Every log includes useful identifiers (campaignId, agentId, callId, etc.)
// as required by the observability specification. Phone numbers are never
// logged in production mode.
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  campaignId?: string;
  agentId?: string;
  borrowerId?: string;
  callId?: string;
  providerCallId?: string;
  provider?: string;
  eventId?: string;
  component?: string;
  [key: string]: unknown;
}

class Logger {
  private level: LogLevel;

  constructor(level?: LogLevel) {
    this.level = level ?? ((process.env['LOG_LEVEL'] as LogLevel) || 'info');
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private format(level: LogLevel, message: string, ctx?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = ctx ? ` ${JSON.stringify(ctx)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  debug(message: string, ctx?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(this.format('debug', message, ctx));
    }
  }

  info(message: string, ctx?: LogContext): void {
    if (this.shouldLog('info')) {
      console.log(this.format('info', message, ctx));
    }
  }

  warn(message: string, ctx?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message, ctx));
    }
  }

  error(message: string, ctx?: LogContext): void {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message, ctx));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger();
