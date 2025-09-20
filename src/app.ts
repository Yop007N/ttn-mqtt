// app.ts
import express from "express";
import deviceRoutes from "./routes/deviceRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { logger, requestLogger } from "./utils/logger";
import { initializeMqttClient } from "./mqtt/mqttClient";
import db from "./models/index";
import dotenv from "dotenv";
import { config } from "./config/config";
import apiRouter from "./api";
import { enhancedMetricsMiddleware } from "./api/versions/v1/routes/metricsRoutes";
import { sanitizeInput } from "./api/versions/v1/middleware/validation";
import { cacheService } from "./services/cacheService";

dotenv.config();

const app = express();
const PORT = config.server?.port || process.env.PORT || 3000;

// Global middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);
app.use(enhancedMetricsMiddleware);
app.use(sanitizeInput);

// API versioning
app.use("/api", apiRouter);

// Legacy routes for backward compatibility
app.use("/api", deviceRoutes);

app.use(errorHandler);

// Sequential initialization
async function initializeDatabase(): Promise<void> {
  try {
    await db.authenticate();
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
}

async function initializeCacheService(): Promise<void> {
  try {
    await cacheService.connect();
    logger.info('Cache service initialized successfully');
  } catch (error) {
    logger.warn('Cache service initialization failed, continuing without cache:', error);
  }
}

async function initializeMqttService(): Promise<void> {
  try {
    await initializeMqttClient();
    logger.info('MQTT client initialized successfully');
  } catch (error) {
    logger.error('MQTT client initialization failed:', error);
    process.exit(1);
  }
}

async function startServer(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(PORT, () => {
      logger.info(`Server is running on http://localhost:${PORT}/api/devices`);
      resolve();
    });
  });
}

// Main initialization function
async function initializeApp(): Promise<void> {
  try {
    logger.info('Starting application initialization...');
    await initializeDatabase();
    await initializeCacheService();
    await initializeMqttService();
    await startServer();
    logger.info('Application initialized successfully');

    // Log application URLs
    logger.info('Application endpoints:', {
      health: `http://localhost:${PORT}/api/v1/health`,
      metrics: `http://localhost:${PORT}/api/v1/metrics`,
      devices: `http://localhost:${PORT}/api/v1/devices`,
      api_root: `http://localhost:${PORT}/api`
    });
  } catch (error) {
    logger.error('Application initialization failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);

  try {
    // Close cache connections
    await cacheService.disconnect();
    logger.info('Cache service disconnected');

    // Close database connections
    await db.close();
    logger.info('Database connections closed');

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the application
initializeApp();