import { Router, Request, Response } from 'express';
import { logger } from '../../../../utils/logger';
import { cacheService } from '../../../../services/cacheService';
import { rateLimiter } from '../middleware/rateLimiter';

/**
 * Enhanced metrics routes for API v1
 * Provides comprehensive application and business metrics
 */
const router = Router();

interface BusinessMetrics {
  devices: {
    total: number;
    active: number;
    inactive: number;
    lastHour: number;
    byApplication: Record<string, number>;
  };
  messages: {
    total: number;
    lastHour: number;
    lastDay: number;
    successRate: number;
    errorRate: number;
  };
  performance: {
    averageResponseTime: number;
    slowQueries: number;
    cacheHitRate: number;
    mqttConnectionUptime: number;
  };
}

// Enhanced metrics collector with business logic
class MetricsCollectorV1 {
  private metrics: Map<string, any> = new Map();
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private gauges: Map<string, number> = new Map();
  private timestamps: Map<string, number[]> = new Map();

  // Enhanced counter with labels
  incrementCounter(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const key = this.buildMetricKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    this.recordTimestamp(key);
  }

  // Enhanced gauge with labels
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildMetricKey(name, labels);
    this.gauges.set(key, value);
    this.recordTimestamp(key);
  }

  // Enhanced histogram with labels
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildMetricKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    const values = this.histograms.get(key)!;
    values.push(value);

    // Keep only last 10000 values with sliding window
    if (values.length > 10000) {
      values.shift();
    }
    this.recordTimestamp(key);
  }

  private buildMetricKey(name: string, labels: Record<string, string>): string {
    if (Object.keys(labels).length === 0) {
      return name;
    }
    const labelString = Object.entries(labels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
    return `${name}{${labelString}}`;
  }

  private recordTimestamp(key: string): void {
    if (!this.timestamps.has(key)) {
      this.timestamps.set(key, []);
    }
    const timestamps = this.timestamps.get(key)!;
    timestamps.push(Date.now());

    // Keep only last hour of timestamps
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    while (timestamps.length > 0 && timestamps[0] < oneHourAgo) {
      timestamps.shift();
    }
  }

  // Get metrics for specific time window
  getMetricsInWindow(windowMs: number): any {
    const cutoff = Date.now() - windowMs;
    const result: any = {
      counters: {},
      gauges: {},
      histograms: {}
    };

    // Filter counters by timestamp
    this.counters.forEach((value, key) => {
      const timestamps = this.timestamps.get(key) || [];
      const recentCount = timestamps.filter(ts => ts > cutoff).length;
      if (recentCount > 0) {
        result.counters[key] = recentCount;
      }
    });

    return result;
  }

  // Enhanced Prometheus format with labels
  getPrometheusMetrics(): string {
    let output = '';

    // Counters
    this.counters.forEach((value, key) => {
      const metricName = key.split('{')[0];
      output += `# TYPE ${metricName} counter\n`;
      output += `${key} ${value}\n`;
    });

    // Gauges
    this.gauges.forEach((value, key) => {
      const metricName = key.split('{')[0];
      output += `# TYPE ${metricName} gauge\n`;
      output += `${key} ${value}\n`;
    });

    // Histograms with enhanced buckets
    this.histograms.forEach((values, key) => {
      if (values.length > 0) {
        const metricName = key.split('{')[0];
        const sorted = [...values].sort((a, b) => a - b);
        const count = values.length;
        const sum = values.reduce((a, b) => a + b, 0);

        output += `# TYPE ${metricName} histogram\n`;
        output += `${key}_count ${count}\n`;
        output += `${key}_sum ${sum}\n`;

        // More granular buckets
        const buckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100];
        buckets.forEach(bucket => {
          const count = sorted.filter(v => v <= bucket).length;
          output += `${key}_bucket{le="${bucket}"} ${count}\n`;
        });
        output += `${key}_bucket{le="+Inf"} ${count}\n`;
      }
    });

    return output;
  }

  // Enhanced JSON metrics with business context
  async getEnhancedJSONMetrics(): Promise<any> {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Get cache metrics
    const cacheMetrics = cacheService.getMetrics();

    // Calculate histogram stats
    const histogramStats: any = {};
    this.histograms.forEach((values, key) => {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const count = values.length;
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / count;

        histogramStats[key] = {
          count,
          sum,
          avg: Math.round(avg * 1000) / 1000,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          p50: sorted[Math.floor(count * 0.5)],
          p90: sorted[Math.floor(count * 0.9)],
          p95: sorted[Math.floor(count * 0.95)],
          p99: sorted[Math.floor(count * 0.99)],
        };
      }
    });

    return {
      timestamp: new Date().toISOString(),
      uptime,
      version: 'v1',
      system: {
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024),
          heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
        },
        cpu: process.cpuUsage(),
        loadAverage: require('os').loadavg()
      },
      cache: cacheMetrics,
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramStats,
    };
  }

  // Get business metrics
  async getBusinessMetrics(): Promise<BusinessMetrics> {
    // These would typically query the database
    // For now, return mock data structure
    return {
      devices: {
        total: this.counters.get('devices_total') || 0,
        active: this.counters.get('devices_active') || 0,
        inactive: this.counters.get('devices_inactive') || 0,
        lastHour: this.getMetricsInWindow(60 * 60 * 1000).counters['devices_created'] || 0,
        byApplication: {}
      },
      messages: {
        total: this.counters.get('mqtt_messages_total') || 0,
        lastHour: this.getMetricsInWindow(60 * 60 * 1000).counters['mqtt_messages_total'] || 0,
        lastDay: this.getMetricsInWindow(24 * 60 * 60 * 1000).counters['mqtt_messages_total'] || 0,
        successRate: 95.5, // Would be calculated from success/error ratios
        errorRate: 4.5
      },
      performance: {
        averageResponseTime: this.calculateAverageFromHistogram('http_request_duration_seconds'),
        slowQueries: this.counters.get('slow_queries_total') || 0,
        cacheHitRate: cacheService.getMetrics().hitRate,
        mqttConnectionUptime: uptime
      }
    };
  }

  private calculateAverageFromHistogram(name: string): number {
    const values = this.histograms.get(name);
    if (!values || values.length === 0) return 0;

    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round((sum / values.length) * 1000) / 1000;
  }
}

// Global enhanced metrics collector
export const metricsCollectorV1 = new MetricsCollectorV1();

// Initialize with application metadata
metricsCollectorV1.incrementCounter('app_started_total', 1, { version: 'v1' });
metricsCollectorV1.setGauge('app_info', 1, {
  version: process.env.npm_package_version || '1.0.0',
  node_version: process.version,
  api_version: 'v1'
});

// Enhanced middleware to track HTTP requests with labels
export const enhancedMetricsMiddleware = (req: Request, res: Response, next: Function) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route?.path || req.path;
    const method = req.method;
    const statusCode = res.statusCode;
    const statusClass = `${Math.floor(statusCode / 100)}xx`;

    const labels = {
      method: method.toLowerCase(),
      route,
      status_code: statusCode.toString(),
      status_class: statusClass
    };

    // Increment counters with labels
    metricsCollectorV1.incrementCounter('http_requests_total', 1, labels);
    metricsCollectorV1.incrementCounter('http_requests_total', 1, { method: method.toLowerCase() });

    // Track response time with labels
    metricsCollectorV1.observeHistogram('http_request_duration_seconds', duration / 1000, labels);

    // Track request size
    if (req.get('content-length')) {
      const size = parseInt(req.get('content-length')!);
      metricsCollectorV1.observeHistogram('http_request_size_bytes', size, { method: method.toLowerCase() });
    }

    // Track response size
    if (res.get('content-length')) {
      const size = parseInt(res.get('content-length')!);
      metricsCollectorV1.observeHistogram('http_response_size_bytes', size, { method: method.toLowerCase() });
    }

    logger.debug(`HTTP ${method} ${route} ${statusCode} ${duration}ms`, {
      correlationId: req.correlationId,
      duration,
      statusCode,
      method,
      route
    });
  });

  next();
};

// Routes

// Prometheus metrics endpoint
router.get('/',
  rateLimiter('metrics', { max: 200, windowMs: 60000 }),
  (req: Request, res: Response) => {
    try {
      const metrics = metricsCollectorV1.getPrometheusMetrics();
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      logger.error('Failed to generate Prometheus metrics:', error, {
        correlationId: req.correlationId
      });
      res.status(500).json({
        error: 'Failed to generate metrics',
        correlationId: req.correlationId,
        version: 'v1'
      });
    }
  }
);

// Enhanced JSON metrics endpoint
router.get('/json',
  rateLimiter('metrics_json', { max: 100, windowMs: 60000 }),
  async (req: Request, res: Response) => {
    try {
      const metrics = await metricsCollectorV1.getEnhancedJSONMetrics();
      res.json({
        ...metrics,
        correlationId: req.correlationId
      });
    } catch (error) {
      logger.error('Failed to generate JSON metrics:', error, {
        correlationId: req.correlationId
      });
      res.status(500).json({
        error: 'Failed to generate metrics',
        correlationId: req.correlationId,
        version: 'v1'
      });
    }
  }
);

// Business metrics endpoint
router.get('/business',
  rateLimiter('business_metrics', { max: 50, windowMs: 60000 }),
  async (req: Request, res: Response) => {
    try {
      const businessMetrics = await metricsCollectorV1.getBusinessMetrics();
      res.json({
        ...businessMetrics,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
        version: 'v1'
      });
    } catch (error) {
      logger.error('Failed to generate business metrics:', error, {
        correlationId: req.correlationId
      });
      res.status(500).json({
        error: 'Failed to generate business metrics',
        correlationId: req.correlationId,
        version: 'v1'
      });
    }
  }
);

// Time-windowed metrics
router.get('/window/:minutes',
  rateLimiter('window_metrics', { max: 50, windowMs: 60000 }),
  (req: Request, res: Response) => {
    try {
      const minutes = parseInt(req.params.minutes);
      if (isNaN(minutes) || minutes < 1 || minutes > 1440) { // Max 24 hours
        return res.status(400).json({
          error: 'Invalid minutes parameter. Must be between 1 and 1440',
          correlationId: req.correlationId,
          version: 'v1'
        });
      }

      const windowMs = minutes * 60 * 1000;
      const metrics = metricsCollectorV1.getMetricsInWindow(windowMs);

      res.json({
        ...metrics,
        windowMinutes: minutes,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
        version: 'v1'
      });
    } catch (error) {
      logger.error('Failed to generate window metrics:', error, {
        correlationId: req.correlationId
      });
      res.status(500).json({
        error: 'Failed to generate window metrics',
        correlationId: req.correlationId,
        version: 'v1'
      });
    }
  }
);

export const metricsRoutes = router;