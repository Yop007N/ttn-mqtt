import { Router } from 'express';
import deviceRoutesV1 from './routes/deviceRoutes';
import { healthRoutes } from './routes/healthRoutes';
import { metricsRoutes } from './routes/metricsRoutes';

/**
 * API v1 Router
 * Centralizes all v1 endpoints with proper versioning
 */
const v1Router = Router();

// Mount route modules
v1Router.use('/devices', deviceRoutesV1);
v1Router.use('/health', healthRoutes);
v1Router.use('/metrics', metricsRoutes);

export default v1Router;