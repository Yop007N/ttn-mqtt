import { Router, Request, Response } from 'express';
import { sequelize } from '../../../../config/config';
import { getMqttConnectionStatus, mqttHealthCheck } from '../../../../mqtt/mqttClient';
import { cacheService } from '../../../../services/cacheService';
import { logger } from '../../../../utils/logger';
import config from '../../../../config/config';

/**
 * Enhanced health check routes for API v1
 * Provides comprehensive service monitoring with detailed metrics
 */
const router = Router();

interface HealthStatusV1 {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  correlationId?: string;
  services: {
    database: ServiceHealthV1;
    mqtt: ServiceHealthV1;
    cache: ServiceHealthV1;
    memory: MemoryHealthV1;
  };
  metrics: HealthMetrics;
}

interface ServiceHealthV1 {
  status: 'up' | 'down' | 'degraded';
  responseTime?: number;
  error?: string;
  lastChecked: string;
  details?: any;
}

interface MemoryHealthV1 {
  status: 'normal' | 'warning' | 'critical';
  usage: {
    used: number;
    total: number;
    percentage: number;
  };
  heap: {
    used: number;
    total: number;
    percentage: number;
  };
  gc?: {
    collections: number;
    pauseTime: number;
  };
}

interface HealthMetrics {
  requestCount: number;
  averageResponseTime: number;
  errorRate: number;
  lastError?: string;
  systemLoad: number[];
}

// Enhanced database health check
async function checkDatabaseHealthV1(): Promise<ServiceHealthV1> {
  const startTime = Date.now();
  try {
    // Test basic connectivity
    await sequelize.authenticate();

    // Test query performance
    const [results] = await sequelize.query('SELECT 1 as test');

    const responseTime = Date.now() - startTime;

    // Check connection pool status
    const poolStatus = {
      active: sequelize.connectionManager.pool?.size || 0,
      idle: sequelize.connectionManager.pool?.available || 0,
      total: sequelize.connectionManager.pool?.max || 0
    };

    return {
      status: responseTime > 5000 ? 'degraded' : 'up',
      responseTime,
      lastChecked: new Date().toISOString(),
      details: {
        pool: poolStatus,
        queryTest: results ? 'passed' : 'failed'
      }
    };
  } catch (error) {
    return {
      status: 'down',
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown database error',
      lastChecked: new Date().toISOString(),
    };
  }
}

// Enhanced MQTT health check
async function checkMqttHealthV1(): Promise<ServiceHealthV1> {
  const startTime = Date.now();
  try {
    const isHealthy = await mqttHealthCheck();
    const isConnected = getMqttConnectionStatus();
    const responseTime = Date.now() - startTime;

    return {
      status: isHealthy && isConnected ? 'up' : 'down',
      responseTime,
      lastChecked: new Date().toISOString(),
      details: {
        connected: isConnected,
        healthy: isHealthy
      }
    };
  } catch (error) {
    return {
      status: 'down',
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown MQTT error',
      lastChecked: new Date().toISOString(),
    };
  }
}

// Enhanced cache health check
async function checkCacheHealthV1(): Promise<ServiceHealthV1> {
  const startTime = Date.now();
  try {
    const health = await cacheService.getHealth();
    const metrics = cacheService.getMetrics();
    const responseTime = Date.now() - startTime;

    return {
      status: health.status === 'healthy' ? 'up' : 'down',
      responseTime,
      lastChecked: new Date().toISOString(),
      details: {
        metrics,
        latency: health.latency
      }
    };
  } catch (error) {
    return {
      status: 'down',
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Cache service unavailable',
      lastChecked: new Date().toISOString(),
    };
  }
}

// Enhanced memory health check
function checkMemoryHealthV1(): MemoryHealthV1 {
  const memUsage = process.memoryUsage();
  const totalMemory = require('os').totalmem();
  const freeMemory = require('os').freemem();
  const usedMemory = totalMemory - freeMemory;

  const memoryPercentage = (usedMemory / totalMemory) * 100;
  const heapPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  let memoryStatus: 'normal' | 'warning' | 'critical' = 'normal';
  if (memoryPercentage > 90 || heapPercentage > 90) {
    memoryStatus = 'critical';
  } else if (memoryPercentage > 80 || heapPercentage > 80) {
    memoryStatus = 'warning';
  }

  return {
    status: memoryStatus,
    usage: {
      used: Math.round(usedMemory / 1024 / 1024), // MB
      total: Math.round(totalMemory / 1024 / 1024), // MB
      percentage: Math.round(memoryPercentage * 100) / 100,
    },
    heap: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      percentage: Math.round(heapPercentage * 100) / 100,
    },
  };
}

// Get system metrics
function getHealthMetrics(): HealthMetrics {
  const loadAvg = require('os').loadavg();

  return {
    requestCount: 0, // Would be tracked by middleware
    averageResponseTime: 0, // Would be tracked by middleware
    errorRate: 0, // Would be tracked by middleware
    systemLoad: loadAvg
  };
}

// Main health check endpoint for v1
router.get('/', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    // Run health checks in parallel for better performance
    const [databaseHealth, mqttHealth, cacheHealth] = await Promise.all([
      checkDatabaseHealthV1(),
      checkMqttHealthV1(),
      checkCacheHealthV1(),
    ]);

    const memoryHealth = checkMemoryHealthV1();
    const metrics = getHealthMetrics();

    // Determine overall status with enhanced logic
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    const downServices = [databaseHealth, mqttHealth, cacheHealth]
      .filter(service => service.status === 'down').length;

    const degradedServices = [databaseHealth, mqttHealth, cacheHealth]
      .filter(service => service.status === 'degraded').length;

    if (downServices > 0 || memoryHealth.status === 'critical') {
      overallStatus = 'unhealthy';
    } else if (degradedServices > 0 || memoryHealth.status === 'warning') {
      overallStatus = 'degraded';
    }

    const healthStatus: HealthStatusV1 = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
      correlationId: req.correlationId,
      services: {
        database: databaseHealth,
        mqtt: mqttHealth,
        cache: cacheHealth,
        memory: memoryHealth,
      },
      metrics
    };

    const responseTime = Date.now() - startTime;

    // Enhanced status code logic
    const httpStatus = overallStatus === 'healthy' ? 200 :
                      overallStatus === 'degraded' ? 200 : 503;

    logger.info('Health check completed', {
      status: overallStatus,
      responseTime,
      correlationId: req.correlationId,
      services: {
        database: databaseHealth.status,
        mqtt: mqttHealth.status,
        cache: cacheHealth.status,
        memory: memoryHealth.status
      }
    });

    res.status(httpStatus).json({
      ...healthStatus,
      responseTime: `${responseTime}ms`,
      version: 'v1'
    });

  } catch (error) {
    logger.error('Health check failed:', error, {
      correlationId: req.correlationId
    });

    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
      correlationId: req.correlationId,
      version: 'v1'
    });
  }
});

// Liveness probe - simple endpoint for Kubernetes/Docker
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    correlationId: req.correlationId,
    version: 'v1'
  });
});

// Readiness probe - enhanced for v1
router.get('/ready', async (req: Request, res: Response) => {
  try {
    const [databaseHealth, mqttHealth, cacheHealth] = await Promise.all([
      checkDatabaseHealthV1(),
      checkMqttHealthV1(),
      checkCacheHealthV1(),
    ]);

    // More nuanced readiness check
    const criticalServices = [databaseHealth, mqttHealth];
    const isReady = criticalServices.every(service => service.status !== 'down');

    if (isReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
        services: {
          database: databaseHealth.status,
          mqtt: mqttHealth.status,
          cache: cacheHealth.status,
        },
        version: 'v1'
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
        services: {
          database: databaseHealth.status,
          mqtt: mqttHealth.status,
          cache: cacheHealth.status,
        },
        version: 'v1'
      });
    }
  } catch (error) {
    logger.error('Readiness check failed:', error, {
      correlationId: req.correlationId
    });

    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Readiness check failed',
      correlationId: req.correlationId,
      version: 'v1'
    });
  }
});

export const healthRoutes = router;