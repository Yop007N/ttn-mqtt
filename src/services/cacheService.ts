import Redis from 'ioredis';
import { logger } from '../utils/logger';
import config from '../config/config';

/**
 * Advanced caching service with Redis integration
 * Supports multiple cache strategies, compression, and automatic expiration
 */

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  compress?: boolean; // Enable compression for large values
  tags?: string[]; // Cache tags for bulk invalidation
  namespace?: string; // Namespace for key organization
}

interface CacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
}

class CacheService {
  private redis: Redis;
  private isConnected: boolean = false;
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0
  };

  private defaultTTL = 3600; // 1 hour
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: this.maxRetries,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4,
      keyPrefix: 'ttn-mqtt:',
      db: parseInt(process.env.REDIS_DB || '0'),
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis cache service connected successfully');
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      this.metrics.errors++;
      logger.error('Redis connection error:', error);
    });

    this.redis.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.redis.connect();
      this.isConnected = true;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
      this.isConnected = false;
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }

  // Core cache operations
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, cache miss');
      this.metrics.misses++;
      return null;
    }

    try {
      const fullKey = this.buildKey(key, options.namespace);
      const value = await this.redis.get(fullKey);

      if (value === null) {
        this.metrics.misses++;
        return null;
      }

      this.metrics.hits++;

      // Decompress if needed
      const decompressed = options.compress ?
        await this.decompress(value) : value;

      return JSON.parse(decompressed);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, cache set failed');
      return false;
    }

    try {
      const fullKey = this.buildKey(key, options.namespace);
      const ttl = options.ttl || this.defaultTTL;

      let serialized = JSON.stringify(value);

      // Compress if enabled and value is large
      if (options.compress && serialized.length > 1024) {
        serialized = await this.compress(serialized);
      }

      const result = await this.redis.setex(fullKey, ttl, serialized);

      // Store tags for bulk invalidation
      if (options.tags && options.tags.length > 0) {
        await this.addToTags(fullKey, options.tags);
      }

      this.metrics.sets++;
      return result === 'OK';
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  async delete(key: string, namespace?: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const fullKey = this.buildKey(key, namespace);
      const result = await this.redis.del(fullKey);
      this.metrics.deletes++;
      return result > 0;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  // Advanced cache operations
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key, options);

    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  async invalidateByTag(tag: string): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const tagKey = `tag:${tag}`;
      const keys = await this.redis.smembers(tagKey);

      if (keys.length === 0) {
        return 0;
      }

      // Delete all keys with this tag
      const pipeline = this.redis.pipeline();
      keys.forEach(key => pipeline.del(key));
      pipeline.del(tagKey); // Remove the tag set itself

      const results = await pipeline.exec();
      const deletedCount = results?.filter(([err, result]) =>
        !err && result === 1
      ).length || 0;

      logger.info(`Invalidated ${deletedCount} cache entries with tag: ${tag}`);
      return deletedCount;
    } catch (error) {
      logger.error(`Error invalidating cache by tag ${tag}:`, error);
      return 0;
    }
  }

  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keys);
      logger.info(`Invalidated ${result} cache entries matching pattern: ${pattern}`);
      return result;
    } catch (error) {
      logger.error(`Error invalidating cache by pattern ${pattern}:`, error);
      return 0;
    }
  }

  // Cache warming strategies
  async warmCache(entries: Array<{key: string, factory: () => Promise<any>, options?: CacheOptions}>): Promise<void> {
    logger.info(`Warming cache with ${entries.length} entries`);

    const promises = entries.map(async (entry) => {
      try {
        const value = await entry.factory();
        await this.set(entry.key, value, entry.options);
      } catch (error) {
        logger.error(`Failed to warm cache for key ${entry.key}:`, error);
      }
    });

    await Promise.allSettled(promises);
    logger.info('Cache warming completed');
  }

  // Utility methods
  private buildKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}:${key}` : key;
  }

  private async addToTags(key: string, tags: string[]): Promise<void> {
    const pipeline = this.redis.pipeline();

    tags.forEach(tag => {
      const tagKey = `tag:${tag}`;
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, this.defaultTTL * 2); // Tags live longer
    });

    await pipeline.exec();
  }

  private async compress(data: string): Promise<string> {
    // Simple compression using Buffer (in production, use proper compression library)
    return Buffer.from(data).toString('base64');
  }

  private async decompress(data: string): Promise<string> {
    return Buffer.from(data, 'base64').toString();
  }

  // Health and metrics
  async getHealth(): Promise<{status: string, latency: number}> {
    const start = Date.now();

    try {
      await this.redis.ping();
      return {
        status: 'healthy',
        latency: Date.now() - start
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - start
      };
    }
  }

  getMetrics(): CacheMetrics & {hitRate: number} {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;

    return {
      ...this.metrics,
      hitRate: Math.round(hitRate * 100) / 100
    };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };
  }

  // Advanced patterns
  async lock(key: string, ttl: number = 30): Promise<string | null> {
    const lockKey = `lock:${key}`;
    const identifier = `${Date.now()}-${Math.random()}`;

    const result = await this.redis.set(lockKey, identifier, 'EX', ttl, 'NX');
    return result === 'OK' ? identifier : null;
  }

  async unlock(key: string, identifier: string): Promise<boolean> {
    const lockKey = `lock:${key}`;

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, lockKey, identifier);
    return result === 1;
  }

  async increment(key: string, by: number = 1, ttl?: number): Promise<number> {
    const pipeline = this.redis.pipeline();
    pipeline.incrby(key, by);

    if (ttl) {
      pipeline.expire(key, ttl);
    }

    const results = await pipeline.exec();
    return results?.[0]?.[1] as number || 0;
  }
}

// Export singleton instance
export const cacheService = new CacheService();
export default cacheService;