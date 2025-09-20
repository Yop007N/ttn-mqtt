import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import config from '../config/config';

/**
 * Advanced structured logging system with multiple transports,
 * log rotation, and correlation IDs for distributed tracing
 */

// Define log levels with priorities
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Custom log format with structured data
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, correlationId, userId, ...meta } = info;

    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      correlationId: correlationId || 'N/A',
      service: 'ttn-mqtt-gateway',
      environment: config.nodeEnv,
      version: process.env.npm_package_version || '1.0.0',
      pid: process.pid,
      ...(userId && { userId }),
      ...(Object.keys(meta).length > 0 && { metadata: meta }),
      ...(stack && { stack }),
    };

    return JSON.stringify(logEntry);
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf((info) => {
    const { timestamp, level, message, correlationId, ...meta } = info;
    const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
    const corrId = correlationId ? `[${correlationId}]` : '';
    return `${timestamp} ${level} ${corrId} ${message} ${metaStr}`;
  })
);

// Create transports based on environment
const createTransports = (): winston.transport[] => {
  const transports: winston.transport[] = [];

  // Console transport
  if (config.nodeEnv === 'development') {
    transports.push(
      new winston.transports.Console({
        format: consoleFormat,
        level: 'debug',
      })
    );
  } else {
    transports.push(
      new winston.transports.Console({
        format: logFormat,
        level: config.logging.level,
      })
    );
  }

  // File transports with rotation
  if (config.logging.fileRotation) {
    // Error logs
    transports.push(
      new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        format: logFormat,
        maxSize: config.logging.maxSize,
        maxFiles: config.logging.maxFiles,
        zippedArchive: true,
      })
    );

    // Combined logs
    transports.push(
      new DailyRotateFile({
        filename: 'logs/combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        format: logFormat,
        maxSize: config.logging.maxSize,
        maxFiles: config.logging.maxFiles,
        zippedArchive: true,
      })
    );

    // HTTP access logs
    transports.push(
      new DailyRotateFile({
        filename: 'logs/access-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'http',
        format: logFormat,
        maxSize: config.logging.maxSize,
        maxFiles: config.logging.maxFiles,
        zippedArchive: true,
      })
    );
  }

  return transports;
};

// Create Winston logger instance
const winstonLogger = winston.createLogger({
  levels: logLevels,
  level: config.logging.level,
  format: logFormat,
  transports: createTransports(),
  exitOnError: false,
  silent: config.nodeEnv === 'test',
});

// Enhanced logger interface with additional functionality
interface LogContext {
  correlationId?: string;
  userId?: string;
  requestId?: string;
  sessionId?: string;
  operation?: string;
  component?: string;
  [key: string]: any;
}

interface Logger {
  error(message: string, error?: Error | any, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  http(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;

  // Specialized logging methods
  audit(action: string, context: LogContext): void;
  security(event: string, context: LogContext): void;
  performance(operation: string, duration: number, context?: LogContext): void;

  // Correlation ID management
  child(context: LogContext): Logger;

  // Log level management
  setLevel(level: string): void;
  getLevel(): string;
}

class EnhancedLogger implements Logger {
  private context: LogContext = {};

  constructor(private baseLogger: winston.Logger, initialContext: LogContext = {}) {
    this.context = { ...initialContext };
  }

  private log(level: string, message: string, meta: any = {}, context: LogContext = {}): void {
    const logData = {
      ...this.context,
      ...context,
      ...meta,
    };

    this.baseLogger.log(level, message, logData);
  }

  error(message: string, error?: Error | any, context: LogContext = {}): void {
    const errorMeta = error instanceof Error
      ? { error: error.message, stack: error.stack }
      : error ? { error } : {};

    this.log('error', message, errorMeta, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.log('warn', message, {}, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.log('info', message, {}, context);
  }

  http(message: string, context: LogContext = {}): void {
    this.log('http', message, {}, context);
  }

  debug(message: string, context: LogContext = {}): void {
    this.log('debug', message, {}, context);
  }

  // Specialized logging methods
  audit(action: string, context: LogContext): void {
    this.info(`AUDIT: ${action}`, {
      ...context,
      logType: 'audit',
      timestamp: new Date().toISOString(),
    });
  }

  security(event: string, context: LogContext): void {
    this.warn(`SECURITY: ${event}`, {
      ...context,
      logType: 'security',
      timestamp: new Date().toISOString(),
    });
  }

  performance(operation: string, duration: number, context: LogContext = {}): void {
    const level = duration > 5000 ? 'warn' : duration > 1000 ? 'info' : 'debug';

    this.log(level, `PERFORMANCE: ${operation} took ${duration}ms`, {
      ...context,
      logType: 'performance',
      operation,
      duration,
      slow: duration > 1000,
    });
  }

  child(context: LogContext): Logger {
    return new EnhancedLogger(this.baseLogger, {
      ...this.context,
      ...context,
    });
  }

  setLevel(level: string): void {
    this.baseLogger.level = level;
  }

  getLevel(): string {
    return this.baseLogger.level;
  }
}

// Correlation ID management
export class CorrelationManager {
  private static instance: CorrelationManager;
  private storage = new Map<string, string>();

  static getInstance(): CorrelationManager {
    if (!CorrelationManager.instance) {
      CorrelationManager.instance = new CorrelationManager();
    }
    return CorrelationManager.instance;
  }

  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  setCorrelationId(id: string): void {
    const asyncId = process.pid.toString(); // Simplified for demo
    this.storage.set(asyncId, id);
  }

  getCorrelationId(): string | undefined {
    const asyncId = process.pid.toString(); // Simplified for demo
    return this.storage.get(asyncId);
  }

  withCorrelationId<T>(id: string, fn: () => T): T {
    this.setCorrelationId(id);
    try {
      return fn();
    } finally {
      const asyncId = process.pid.toString();
      this.storage.delete(asyncId);
    }
  }
}

// Export enhanced logger instance
export const logger = new EnhancedLogger(winstonLogger);

// Export convenience functions
export const createLogger = (context: LogContext): Logger => {
  return logger.child(context);
};

export const withCorrelation = <T>(fn: () => T): T => {
  const correlationId = CorrelationManager.getInstance().generateId();
  return CorrelationManager.getInstance().withCorrelationId(correlationId, fn);
};

// HTTP request logger middleware
export const requestLogger = (req: any, res: any, next: any) => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] || CorrelationManager.getInstance().generateId();

  // Set correlation ID for this request
  CorrelationManager.getInstance().setCorrelationId(correlationId);
  req.correlationId = correlationId;

  // Create request-specific logger
  const requestLogger = createLogger({
    correlationId,
    requestId: correlationId,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });

  req.logger = requestLogger;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    requestLogger.http(`${req.method} ${req.url} ${statusCode} - ${duration}ms`, {
      statusCode,
      duration,
      contentLength: res.get('Content-Length'),
    });

    // Log slow requests
    if (duration > 1000) {
      requestLogger.performance(`HTTP ${req.method} ${req.url}`, duration, {
        statusCode,
        slow: true,
      });
    }
  });

  next();
};

export default logger;
  