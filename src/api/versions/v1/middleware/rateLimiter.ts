import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { cacheService } from '../../../../services/cacheService';
import { logger } from '../../../../utils/logger';
import { Request, Response } from 'express';

/**
 * Advanced rate limiting with Redis-backed storage and flexible configuration
 */

interface RateLimitConfig {
  max: number;
  windowMs: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

const defaultRateLimitConfig: RateLimitConfig = {
  max: 100,
  windowMs: 15 * 60 * 1000, // 15 minutes
  skipSuccessfulRequests: false,
  skipFailedRequests: false
};

export const rateLimiter = (
  operation: string,
  config: Partial<RateLimitConfig> = {}
) => {
  const finalConfig = { ...defaultRateLimitConfig, ...config };

  return rateLimit({
    windowMs: finalConfig.windowMs,
    max: finalConfig.max,

    // Use Redis store for distributed rate limiting
    store: new RedisStore({
      sendCommand: async (...args: string[]) => {
        try {
          // Simple Redis command adapter for rate limiting
          const key = args[1] || '';
          const command = args[0]?.toLowerCase();

          switch (command) {
            case 'incr':
              return await cacheService['redis'].incr(key);
            case 'expire':
              await cacheService['redis'].expire(key, parseInt(args[2] || '0'));
              return 'OK';
            case 'ttl':
              return await cacheService['redis'].ttl(key);
            default:
              return null;
          }
        } catch (error) {
          logger.error('Redis rate limiting error:', error);
          return null;
        }
      },
    }),

    // Enhanced message with operation context
    message: {
      error: 'Too many requests',
      message: finalConfig.message || `Too many ${operation} requests from this IP, please try again later.`,
      operation,
      retryAfter: Math.ceil(finalConfig.windowMs / 1000),
      timestamp: new Date().toISOString()
    },

    // Custom key generator including operation
    keyGenerator: (req: Request) => {
      return `rate_limit:${operation}:${req.ip}`;
    },

    // Enhanced request handler with logging
    handler: (req: Request, res: Response) => {
      logger.warn('Rate limit exceeded', {
        operation,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        endpoint: `${req.method} ${req.path}`,
        correlationId: req.correlationId
      });

      res.status(429).json({
        error: 'Too many requests',
        message: finalConfig.message || `Too many ${operation} requests from this IP, please try again later.`,
        operation,
        retryAfter: Math.ceil(finalConfig.windowMs / 1000),
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      });
    },

    // Skip based on configuration
    skip: (req: Request, res: Response) => {
      if (finalConfig.skipSuccessfulRequests && res.statusCode < 400) {
        return true;
      }
      if (finalConfig.skipFailedRequests && res.statusCode >= 400) {
        return true;
      }
      return false;
    },

    // Enhanced request logging
    onLimitReached: (req: Request, res: Response, options) => {
      logger.security('Rate limit threshold reached', {
        operation,
        ip: req.ip,
        limit: finalConfig.max,
        window: finalConfig.windowMs,
        endpoint: `${req.method} ${req.path}`,
        correlationId: req.correlationId
      });
    }
  });
};

// Predefined rate limiters for common operations
export const authRateLimit = rateLimiter('authentication', {
  max: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  message: 'Too many authentication attempts, please try again later'
});

export const apiRateLimit = rateLimiter('api_general', {
  max: 1000,
  windowMs: 15 * 60 * 1000, // 15 minutes
  message: 'API rate limit exceeded'
});

export const uploadRateLimit = rateLimiter('file_upload', {
  max: 10,
  windowMs: 60 * 1000, // 1 minute
  message: 'Too many file uploads, please slow down'
});

export const searchRateLimit = rateLimiter('search', {
  max: 100,
  windowMs: 60 * 1000, // 1 minute
  message: 'Search rate limit exceeded'
});