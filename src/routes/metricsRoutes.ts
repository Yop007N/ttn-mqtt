import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';

const router = Router();

// Simple metrics storage (in production, use Redis or a proper metrics store)
class MetricsCollector {
  private metrics: Map<string, any> = new Map();
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private gauges: Map<string, number> = new Map();

  // Increment a counter
  incrementCounter(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  // Set a gauge value
  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  // Add value to histogram
  observeHistogram(name: string, value: number): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    const values = this.histograms.get(name)!;
    values.push(value);

    // Keep only last 1000 values to prevent memory issues
    if (values.length > 1000) {
      values.shift();
    }
  }

  // Get all metrics in Prometheus format
  getPrometheusMetrics(): string {
    let output = '';

    // Counters
    this.counters.forEach((value, name) => {
      output += `# TYPE ${name} counter\n`;
      output += `${name} ${value}\n`;
    });

    // Gauges
    this.gauges.forEach((value, name) => {
      output += `# TYPE ${name} gauge\n`;
      output += `${name} ${value}\n`;
    });

    // Histograms
    this.histograms.forEach((values, name) => {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const count = values.length;
        const sum = values.reduce((a, b) => a + b, 0);

        output += `# TYPE ${name} histogram\n`;
        output += `${name}_count ${count}\n`;
        output += `${name}_sum ${sum}\n`;

        // Percentiles
        const p50 = sorted[Math.floor(count * 0.5)];
        const p90 = sorted[Math.floor(count * 0.9)];
        const p99 = sorted[Math.floor(count * 0.99)];

        output += `${name}_bucket{le="0.5"} ${sorted.filter(v => v <= 0.5).length}\n`;
        output += `${name}_bucket{le="1"} ${sorted.filter(v => v <= 1).length}\n`;
        output += `${name}_bucket{le="5"} ${sorted.filter(v => v <= 5).length}\n`;
        output += `${name}_bucket{le="10"} ${sorted.filter(v => v <= 10).length}\n`;
        output += `${name}_bucket{le="+Inf"} ${count}\n`;
      }
    });

    return output;
  }

  // Get metrics as JSON
  getJSONMetrics(): any {
    // System metrics
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Calculate histogram stats
    const histogramStats: any = {};
    this.histograms.forEach((values, name) => {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const count = values.length;
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / count;

        histogramStats[name] = {
          count,
          sum,
          avg: Math.round(avg * 1000) / 1000,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          p50: sorted[Math.floor(count * 0.5)],
          p90: sorted[Math.floor(count * 0.9)],
          p99: sorted[Math.floor(count * 0.99)],
        };
      }
    });

    return {
      timestamp: new Date().toISOString(),
      uptime,
      system: {
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          external: Math.round(memUsage.external / 1024 / 1024), // MB
        },
        cpu: process.cpuUsage(),
      },
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramStats,
    };
  }
}

// Global metrics collector instance
export const metricsCollector = new MetricsCollector();

// Initialize some default metrics
metricsCollector.incrementCounter('app_started_total', 1);
metricsCollector.setGauge('app_version', 1);

// Update system metrics periodically
setInterval(() => {
  const memUsage = process.memoryUsage();
  metricsCollector.setGauge('nodejs_memory_heap_used_bytes', memUsage.heapUsed);
  metricsCollector.setGauge('nodejs_memory_heap_total_bytes', memUsage.heapTotal);
  metricsCollector.setGauge('nodejs_memory_rss_bytes', memUsage.rss);
  metricsCollector.setGauge('nodejs_process_uptime_seconds', Math.floor(process.uptime()));
}, 10000); // Update every 10 seconds

// Middleware to track HTTP requests
export const metricsMiddleware = (req: Request, res: Response, next: Function) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route?.path || req.path;
    const method = req.method;
    const statusCode = res.statusCode;

    // Increment request counter
    metricsCollector.incrementCounter('http_requests_total');
    metricsCollector.incrementCounter(`http_requests_${method.toLowerCase()}_total`);
    metricsCollector.incrementCounter(`http_responses_${statusCode}_total`);

    // Track response time
    metricsCollector.observeHistogram('http_request_duration_seconds', duration / 1000);
    metricsCollector.observeHistogram(`http_request_duration_${method.toLowerCase()}_seconds`, duration / 1000);

    // Track request size
    if (req.get('content-length')) {
      const size = parseInt(req.get('content-length')!);
      metricsCollector.observeHistogram('http_request_size_bytes', size);
    }

    logger.debug(`HTTP ${method} ${route} ${statusCode} ${duration}ms`);
  });

  next();
};

// Prometheus metrics endpoint
router.get('/metrics', (req: Request, res: Response) => {
  try {
    const metrics = metricsCollector.getPrometheusMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    logger.error('Failed to generate metrics:', error);
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

// JSON metrics endpoint
router.get('/metrics/json', (req: Request, res: Response) => {
  try {
    const metrics = metricsCollector.getJSONMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Failed to generate JSON metrics:', error);
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

// Reset metrics (useful for testing)
router.post('/metrics/reset', (req: Request, res: Response) => {
  try {
    metricsCollector['counters'].clear();
    metricsCollector['gauges'].clear();
    metricsCollector['histograms'].clear();

    // Reinitialize basic metrics
    metricsCollector.incrementCounter('app_started_total', 1);
    metricsCollector.setGauge('app_version', 1);

    res.json({ message: 'Metrics reset successfully' });
  } catch (error) {
    logger.error('Failed to reset metrics:', error);
    res.status(500).json({ error: 'Failed to reset metrics' });
  }
});

export default router;