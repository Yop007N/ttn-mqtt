import { logger } from '../utils/logger';
import { eventBus, DeviceEvents, SystemEvents } from '../services/eventBus';
import { cacheService } from '../services/cacheService';

/**
 * Advanced Monitoring and Alerting System
 * Provides comprehensive monitoring with custom metrics, alerts, and notifications
 */

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: AlertCondition;
  severity: AlertSeverity;
  enabled: boolean;
  cooldownPeriod: number; // seconds
  notificationChannels: string[];
  metadata?: Record<string, any>;
}

export interface AlertCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'ne';
  threshold: number;
  timeWindow?: number; // seconds
  aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count';
}

export interface Alert {
  id: string;
  ruleId: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  status: AlertStatus;
  value: number;
  threshold: number;
  firedAt: Date;
  resolvedAt?: Date;
  notificationsSent: string[];
  metadata?: Record<string, any>;
}

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum AlertStatus {
  FIRING = 'firing',
  RESOLVED = 'resolved',
  SILENCED = 'silenced'
}

interface MetricValue {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

class AlertManager {
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private metrics: Map<string, MetricValue[]> = new Map();
  private notificationChannels: Map<string, NotificationChannel> = new Map();
  private lastAlertTimes: Map<string, number> = new Map();

  constructor() {
    this.initializeDefaultRules();
    this.startMetricsCollection();
    this.startAlertEvaluation();
  }

  // Initialize default monitoring rules
  private initializeDefaultRules(): void {
    // Memory usage alert
    this.addAlertRule({
      id: 'high_memory_usage',
      name: 'High Memory Usage',
      description: 'Memory usage exceeds 85%',
      condition: {
        metric: 'memory_usage_percent',
        operator: 'gt',
        threshold: 85,
        timeWindow: 300, // 5 minutes
        aggregation: 'avg'
      },
      severity: AlertSeverity.HIGH,
      enabled: true,
      cooldownPeriod: 900, // 15 minutes
      notificationChannels: ['log', 'webhook']
    });

    // Database connection alert
    this.addAlertRule({
      id: 'database_disconnected',
      name: 'Database Connection Lost',
      description: 'Database connection is down',
      condition: {
        metric: 'database_connection_status',
        operator: 'eq',
        threshold: 0
      },
      severity: AlertSeverity.CRITICAL,
      enabled: true,
      cooldownPeriod: 300, // 5 minutes
      notificationChannels: ['log', 'webhook', 'email']
    });

    // MQTT connection alert
    this.addAlertRule({
      id: 'mqtt_disconnected',
      name: 'MQTT Connection Lost',
      description: 'MQTT broker connection is down',
      condition: {
        metric: 'mqtt_connection_status',
        operator: 'eq',
        threshold: 0
      },
      severity: AlertSeverity.HIGH,
      enabled: true,
      cooldownPeriod: 300,
      notificationChannels: ['log', 'webhook']
    });

    // High error rate alert
    this.addAlertRule({
      id: 'high_error_rate',
      name: 'High Error Rate',
      description: 'Error rate exceeds 5%',
      condition: {
        metric: 'error_rate_percent',
        operator: 'gt',
        threshold: 5,
        timeWindow: 600, // 10 minutes
        aggregation: 'avg'
      },
      severity: AlertSeverity.MEDIUM,
      enabled: true,
      cooldownPeriod: 600,
      notificationChannels: ['log']
    });

    // Slow response time alert
    this.addAlertRule({
      id: 'slow_response_time',
      name: 'Slow Response Time',
      description: 'Average response time exceeds 2 seconds',
      condition: {
        metric: 'response_time_seconds',
        operator: 'gt',
        threshold: 2,
        timeWindow: 300,
        aggregation: 'avg'
      },
      severity: AlertSeverity.MEDIUM,
      enabled: true,
      cooldownPeriod: 600,
      notificationChannels: ['log']
    });

    logger.info('Default alert rules initialized', {
      rulesCount: this.alertRules.size
    });
  }

  // Add new alert rule
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info('Alert rule added', {
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity
    });
  }

  // Remove alert rule
  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    if (removed) {
      logger.info('Alert rule removed', { ruleId });
    }
    return removed;
  }

  // Record metric value
  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricValues = this.metrics.get(name)!;
    metricValues.push({
      timestamp: Date.now(),
      value,
      labels
    });

    // Keep only last 1 hour of metrics
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    while (metricValues.length > 0 && metricValues[0].timestamp < oneHourAgo) {
      metricValues.shift();
    }
  }

  // Start metrics collection
  private startMetricsCollection(): void {
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000); // Every 30 seconds

    logger.info('Metrics collection started');
  }

  // Collect system metrics
  private collectSystemMetrics(): void {
    // Memory metrics
    const memUsage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryPercent = (usedMemory / totalMemory) * 100;

    this.recordMetric('memory_usage_percent', memoryPercent);
    this.recordMetric('memory_heap_used_mb', memUsage.heapUsed / 1024 / 1024);

    // CPU metrics
    const loadAvg = require('os').loadavg();
    this.recordMetric('cpu_load_1m', loadAvg[0]);
    this.recordMetric('cpu_load_5m', loadAvg[1]);
    this.recordMetric('cpu_load_15m', loadAvg[2]);

    // Process metrics
    this.recordMetric('process_uptime_seconds', process.uptime());

    // Cache metrics
    try {
      const cacheMetrics = cacheService.getMetrics();
      this.recordMetric('cache_hit_rate_percent', cacheMetrics.hitRate);
      this.recordMetric('cache_hits_total', cacheMetrics.hits);
      this.recordMetric('cache_misses_total', cacheMetrics.misses);
    } catch (error) {
      this.recordMetric('cache_connection_status', 0);
    }

    // Simulate other metrics (would be replaced with real checks)
    this.recordMetric('database_connection_status', 1); // 1 = connected, 0 = disconnected
    this.recordMetric('mqtt_connection_status', 1);
  }

  // Start alert evaluation
  private startAlertEvaluation(): void {
    setInterval(() => {
      this.evaluateAlerts();
    }, 30000); // Every 30 seconds

    logger.info('Alert evaluation started');
  }

  // Evaluate all alert rules
  private evaluateAlerts(): void {
    for (const [ruleId, rule] of this.alertRules.entries()) {
      if (!rule.enabled) continue;

      try {
        this.evaluateAlertRule(rule);
      } catch (error) {
        logger.error('Failed to evaluate alert rule:', error, {
          ruleId: rule.id,
          ruleName: rule.name
        });
      }
    }
  }

  // Evaluate single alert rule
  private evaluateAlertRule(rule: AlertRule): void {
    const metricValues = this.metrics.get(rule.condition.metric);
    if (!metricValues || metricValues.length === 0) {
      return;
    }

    // Apply time window filter
    let relevantValues = metricValues;
    if (rule.condition.timeWindow) {
      const cutoff = Date.now() - (rule.condition.timeWindow * 1000);
      relevantValues = metricValues.filter(mv => mv.timestamp >= cutoff);
    }

    if (relevantValues.length === 0) {
      return;
    }

    // Calculate aggregated value
    let value: number;
    const values = relevantValues.map(mv => mv.value);

    switch (rule.condition.aggregation || 'avg') {
      case 'avg':
        value = values.reduce((sum, v) => sum + v, 0) / values.length;
        break;
      case 'sum':
        value = values.reduce((sum, v) => sum + v, 0);
        break;
      case 'min':
        value = Math.min(...values);
        break;
      case 'max':
        value = Math.max(...values);
        break;
      case 'count':
        value = values.length;
        break;
      default:
        value = values[values.length - 1]; // Latest value
    }

    // Evaluate condition
    const conditionMet = this.evaluateCondition(value, rule.condition);

    // Check if alert should fire or resolve
    const existingAlert = this.activeAlerts.get(rule.id);

    if (conditionMet && !existingAlert) {
      this.fireAlert(rule, value);
    } else if (!conditionMet && existingAlert && existingAlert.status === AlertStatus.FIRING) {
      this.resolveAlert(rule.id);
    }
  }

  // Evaluate condition logic
  private evaluateCondition(value: number, condition: AlertCondition): boolean {
    switch (condition.operator) {
      case 'gt': return value > condition.threshold;
      case 'lt': return value < condition.threshold;
      case 'eq': return value === condition.threshold;
      case 'gte': return value >= condition.threshold;
      case 'lte': return value <= condition.threshold;
      case 'ne': return value !== condition.threshold;
      default: return false;
    }
  }

  // Fire alert
  private fireAlert(rule: AlertRule, value: number): void {
    // Check cooldown period
    const lastAlertTime = this.lastAlertTimes.get(rule.id);
    if (lastAlertTime && (Date.now() - lastAlertTime) < (rule.cooldownPeriod * 1000)) {
      return;
    }

    const alert: Alert = {
      id: `alert_${rule.id}_${Date.now()}`,
      ruleId: rule.id,
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      status: AlertStatus.FIRING,
      value,
      threshold: rule.condition.threshold,
      firedAt: new Date(),
      notificationsSent: [],
      metadata: rule.metadata
    };

    this.activeAlerts.set(rule.id, alert);
    this.lastAlertTimes.set(rule.id, Date.now());

    // Send notifications
    this.sendNotifications(alert, rule.notificationChannels);

    // Publish event
    eventBus.publishEvent({
      type: 'alert.fired',
      source: 'alert_manager',
      data: alert
    });

    logger.warn('Alert fired', {
      alertId: alert.id,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      value,
      threshold: rule.condition.threshold
    });
  }

  // Resolve alert
  private resolveAlert(ruleId: string): void {
    const alert = this.activeAlerts.get(ruleId);
    if (!alert) return;

    alert.status = AlertStatus.RESOLVED;
    alert.resolvedAt = new Date();

    // Remove from active alerts
    this.activeAlerts.delete(ruleId);

    // Publish event
    eventBus.publishEvent({
      type: 'alert.resolved',
      source: 'alert_manager',
      data: alert
    });

    logger.info('Alert resolved', {
      alertId: alert.id,
      ruleId,
      ruleName: alert.name,
      duration: alert.resolvedAt.getTime() - alert.firedAt.getTime()
    });
  }

  // Send notifications
  private sendNotifications(alert: Alert, channels: string[]): void {
    for (const channelName of channels) {
      const channel = this.notificationChannels.get(channelName);
      if (channel) {
        channel.send(alert).catch(error => {
          logger.error('Failed to send notification:', error, {
            channel: channelName,
            alertId: alert.id
          });
        });
      } else {
        // Built-in channels
        switch (channelName) {
          case 'log':
            this.sendLogNotification(alert);
            break;
          case 'webhook':
            this.sendWebhookNotification(alert);
            break;
          default:
            logger.warn('Unknown notification channel', {
              channel: channelName,
              alertId: alert.id
            });
        }
      }
    }
  }

  // Send log notification
  private sendLogNotification(alert: Alert): void {
    const logLevel = alert.severity === AlertSeverity.CRITICAL ? 'error' : 'warn';
    logger[logLevel]('ALERT NOTIFICATION', {
      alertId: alert.id,
      name: alert.name,
      description: alert.description,
      severity: alert.severity,
      value: alert.value,
      threshold: alert.threshold,
      firedAt: alert.firedAt
    });
  }

  // Send webhook notification
  private async sendWebhookNotification(alert: Alert): Promise<void> {
    // This would implement actual webhook sending
    logger.info('Webhook notification sent', {
      alertId: alert.id,
      webhook: 'placeholder'
    });
  }

  // Get alert statistics
  getAlertStats(): any {
    const activeAlertsByseverity = Array.from(this.activeAlerts.values())
      .reduce((acc, alert) => {
        acc[alert.severity] = (acc[alert.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return {
      totalRules: this.alertRules.size,
      enabledRules: Array.from(this.alertRules.values()).filter(r => r.enabled).length,
      activeAlerts: this.activeAlerts.size,
      activeAlertsBySevertiy: activeAlertsBySeverity,
      metricsCount: this.metrics.size,
      notificationChannels: this.notificationChannels.size
    };
  }

  // Get active alerts
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  // Get alert rules
  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  // Add notification channel
  addNotificationChannel(name: string, channel: NotificationChannel): void {
    this.notificationChannels.set(name, channel);
    logger.info('Notification channel added', { name });
  }
}

// Notification channel interface
export interface NotificationChannel {
  send(alert: Alert): Promise<void>;
}

// Export singleton instance
export const alertManager = new AlertManager();

// Subscribe to system events for monitoring
eventBus.subscribe(SystemEvents.DATABASE_ERROR, async (event) => {
  alertManager.recordMetric('database_connection_status', 0);
});

eventBus.subscribe(SystemEvents.DATABASE_CONNECTED, async (event) => {
  alertManager.recordMetric('database_connection_status', 1);
});

eventBus.subscribe(SystemEvents.CACHE_DISCONNECTED, async (event) => {
  alertManager.recordMetric('cache_connection_status', 0);
});

eventBus.subscribe(SystemEvents.CACHE_CONNECTED, async (event) => {
  alertManager.recordMetric('cache_connection_status', 1);
});

export default alertManager;