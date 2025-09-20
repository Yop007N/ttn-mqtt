import { Router, Request, Response, NextFunction } from 'express';
import v1Router from './versions/v1';
import v2Router from './versions/v2';
import { logger } from '../utils/logger';
import { requestLogger } from '../utils/logger';

/**
 * Main API router with comprehensive versioning and middleware
 * Provides centralized API management with backward compatibility
 */
const apiRouter = Router();

// API-wide middleware
apiRouter.use(requestLogger);

// API version detection middleware
const versionDetectionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Extract version from URL path
  const pathVersion = req.path.match(/^\/v(\d+)/)?.[1];

  // Extract version from Accept header (e.g., "application/vnd.api+json;version=1")
  const acceptHeader = req.headers.accept;
  const headerVersion = acceptHeader?.match(/version=(\d+)/)?.[1];

  // Extract version from custom header
  const customHeaderVersion = req.headers['api-version'] as string;

  // Priority: URL path > custom header > Accept header > default to v1
  const detectedVersion = pathVersion || customHeaderVersion || headerVersion || '1';

  // Store version in request for logging and routing
  req.apiVersion = detectedVersion;

  logger.debug('API version detected', {
    version: detectedVersion,
    method: req.method,
    path: req.path,
    correlationId: req.correlationId
  });

  next();
};

// Content negotiation middleware
const contentNegotiationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Set default content type
  if (!req.headers['content-type'] && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
    req.headers['content-type'] = 'application/json';
  }

  // Add API version to response headers
  res.setHeader('API-Version', req.apiVersion || '1');
  res.setHeader('API-Supported-Versions', '1,2');
  res.setHeader('API-Deprecation-Info', 'https://api.ttn-mqtt.com/deprecation');

  next();
};

// Apply middleware
apiRouter.use(versionDetectionMiddleware);
apiRouter.use(contentNegotiationMiddleware);

// Version-specific routers
apiRouter.use('/v1', v1Router);
apiRouter.use('/v2', v2Router);

// Default version routing (no version specified)
apiRouter.use('/', (req: Request, res: Response, next: NextFunction) => {
  // Check if this is a versioned path
  if (req.path.match(/^\/v\d+/)) {
    return next();
  }

  // Route unversioned requests to appropriate version based on detection
  const version = req.apiVersion || '1';

  // Log unversioned request
  logger.warn('Unversioned API request detected', {
    path: req.path,
    method: req.method,
    detectedVersion: version,
    userAgent: req.headers['user-agent'],
    correlationId: req.correlationId
  });

  // Route to appropriate version
  if (version === '2') {
    return v2Router(req, res, next);
  } else {
    return v1Router(req, res, next);
  }
});

// API root endpoint with version information
apiRouter.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'TTN MQTT Gateway API',
    description: 'IoT device data collection and management API',
    currentVersion: req.apiVersion || '1',
    supportedVersions: ['1', '2'],
    versions: {
      v1: {
        status: 'stable',
        baseUrl: '/api/v1',
        documentation: '/api/v1/docs',
        deprecationDate: '2025-06-01'
      },
      v2: {
        status: 'beta',
        baseUrl: '/api/v2',
        documentation: '/api/v2/docs',
        migrationGuide: '/api/v2/migration'
      }
    },
    endpoints: {
      health: '/api/v1/health',
      metrics: '/api/v1/metrics',
      devices: '/api/v1/devices'
    },
    rateLimit: {
      default: '1000 requests per 15 minutes',
      authenticated: '5000 requests per 15 minutes'
    },
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId
  });
});

// Version compatibility endpoint
apiRouter.get('/compatibility', (req: Request, res: Response) => {
  const clientVersion = req.apiVersion;
  const supportedVersions = ['1', '2'];

  const compatibility = {
    clientVersion,
    supportedVersions,
    isSupported: supportedVersions.includes(clientVersion || '1'),
    recommendations: {
      current: clientVersion === '2' ? 'latest' : 'upgrade_recommended',
      migration: clientVersion === '1' ? '/api/v2/migration' : null,
      deprecation: clientVersion === '1' ? '2025-06-01' : null
    },
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId
  };

  res.json(compatibility);
});

// Global error handler for API routes
apiRouter.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('API error occurred', error, {
    path: req.path,
    method: req.method,
    version: req.apiVersion,
    correlationId: req.correlationId
  });

  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? error.message : 'An unexpected error occurred',
    correlationId: req.correlationId,
    version: req.apiVersion || '1',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: error.stack })
  });
});

// 404 handler for unknown API routes
apiRouter.use('*', (req: Request, res: Response) => {
  logger.warn('Unknown API endpoint accessed', {
    path: req.path,
    method: req.method,
    version: req.apiVersion,
    correlationId: req.correlationId
  });

  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} not found`,
    availableVersions: ['v1', 'v2'],
    documentation: '/api',
    correlationId: req.correlationId,
    version: req.apiVersion || '1',
    timestamp: new Date().toISOString()
  });
});

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      apiVersion?: string;
      correlationId?: string;
    }
  }
}

export default apiRouter;