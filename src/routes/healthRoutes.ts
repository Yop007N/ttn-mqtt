import { Router, Request, Response } from 'express';
import { sequelize } from '../config/config';
import { getMqttConnectionStatus, mqttHealthCheck } from '../mqtt/mqttClient';
import { logger } from '../utils/logger';
import config from '../config/config';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: ServiceHealth;
    mqtt: ServiceHealth;
    memory: MemoryHealth;
  };
  details?: any;
}

interface ServiceHealth {
  status: 'up' | 'down' | 'degraded';
  responseTime?: number;
  error?: string;
  lastChecked: string;
}

interface MemoryHealth {
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
}

// Health check for database
async function checkDatabaseHealth(): Promise<ServiceHealth> {
  const startTime = Date.now();
  try {
    await sequelize.authenticate();
    const responseTime = Date.now() - startTime;

    return {
      status: responseTime > 5000 ? 'degraded' : 'up',
      responseTime,
      lastChecked: new Date().toISOString(),
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

// Health check for MQTT
async function checkMqttHealth(): Promise<ServiceHealth> {
  try {
    const isHealthy = await mqttHealthCheck();
    const isConnected = getMqttConnectionStatus();

    return {
      status: isHealthy && isConnected ? 'up' : 'down',
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown MQTT error',
      lastChecked: new Date().toISOString(),
    };
  }
}

// Memory health check
function checkMemoryHealth(): MemoryHealth {
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

// Main health check endpoint
router.get('/health', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    // Run health checks in parallel
    const [databaseHealth, mqttHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkMqttHealth(),
    ]);

    const memoryHealth = checkMemoryHealth();

    // Determine overall status
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    if (
      databaseHealth.status === 'down' ||
      mqttHealth.status === 'down' ||
      memoryHealth.status === 'critical'
    ) {
      overallStatus = 'unhealthy';
    } else if (
      databaseHealth.status === 'degraded' ||
      mqttHealth.status === 'degraded' ||
      memoryHealth.status === 'warning'
    ) {
      overallStatus = 'degraded';
    }

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
      services: {
        database: databaseHealth,
        mqtt: mqttHealth,
        memory: memoryHealth,
      },
    };

    const responseTime = Date.now() - startTime;

    // Set appropriate HTTP status code
    const httpStatus = overallStatus === 'healthy' ? 200 :
                      overallStatus === 'degraded' ? 200 : 503;

    res.status(httpStatus).json({
      ...healthStatus,
      responseTime: `${responseTime}ms`,
    });

  } catch (error) {
    logger.error('Health check failed:', error);

    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

// Liveness probe - simple endpoint for Kubernetes/Docker
router.get('/health/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// Readiness probe - checks if service is ready to handle requests
router.get('/health/ready', async (req: Request, res: Response) => {
  try {
    const [databaseHealth, mqttHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkMqttHealth(),
    ]);

    const isReady = databaseHealth.status !== 'down' && mqttHealth.status !== 'down';

    if (isReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          database: databaseHealth.status,
          mqtt: mqttHealth.status,
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        services: {
          database: databaseHealth.status,
          mqtt: mqttHealth.status,
        },
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Readiness check failed',
    });
  }
});

export default router;