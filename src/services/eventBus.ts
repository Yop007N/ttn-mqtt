import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { cacheService } from './cacheService';

/**
 * Advanced Event-Driven Architecture with Message Queues
 * Provides decoupled communication between services with persistence and reliability
 */

export interface EventPayload {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: any;
  correlationId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface EventSubscription {
  id: string;
  eventType: string;
  handler: (event: EventPayload) => Promise<void>;
  options: {
    retry?: boolean;
    maxRetries?: number;
    deadLetterQueue?: boolean;
    priority?: 'low' | 'normal' | 'high';
  };
}

class EventBusService extends EventEmitter {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private eventHistory: Map<string, EventPayload> = new Map();
  private deadLetterQueue: EventPayload[] = [];
  private processingQueue: EventPayload[] = [];
  private isProcessing = false;

  constructor() {
    super();
    this.setMaxListeners(100);
    this.startEventProcessor();
  }

  // Publish event with persistence and reliability
  async publishEvent(event: Omit<EventPayload, 'id' | 'timestamp'>): Promise<string> {
    const eventId = this.generateEventId();
    const fullEvent: EventPayload = {
      ...event,
      id: eventId,
      timestamp: new Date()
    };

    try {
      // Persist event to cache for reliability
      await cacheService.set(
        `event:${eventId}`,
        fullEvent,
        { ttl: 86400, namespace: 'events' } // 24 hours
      );

      // Add to processing queue
      this.addToQueue(fullEvent);

      // Store in memory for quick access
      this.eventHistory.set(eventId, fullEvent);

      logger.info('Event published', {
        eventId,
        eventType: event.type,
        source: event.source,
        correlationId: event.correlationId
      });

      return eventId;
    } catch (error) {
      logger.error('Failed to publish event:', error, {
        eventType: event.type,
        source: event.source
      });
      throw error;
    }
  }

  // Subscribe to events with advanced options
  subscribe(
    eventType: string,
    handler: (event: EventPayload) => Promise<void>,
    options: EventSubscription['options'] = {}
  ): string {
    const subscriptionId = this.generateSubscriptionId();

    const subscription: EventSubscription = {
      id: subscriptionId,
      eventType,
      handler,
      options: {
        retry: true,
        maxRetries: 3,
        deadLetterQueue: true,
        priority: 'normal',
        ...options
      }
    };

    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, []);
    }

    this.subscriptions.get(eventType)!.push(subscription);

    logger.info('Event subscription created', {
      subscriptionId,
      eventType,
      options: subscription.options
    });

    return subscriptionId;
  }

  // Unsubscribe from events
  unsubscribe(subscriptionId: string): boolean {
    for (const [eventType, subs] of this.subscriptions.entries()) {
      const index = subs.findIndex(sub => sub.id === subscriptionId);
      if (index !== -1) {
        subs.splice(index, 1);
        if (subs.length === 0) {
          this.subscriptions.delete(eventType);
        }
        logger.info('Event subscription removed', { subscriptionId, eventType });
        return true;
      }
    }
    return false;
  }

  // Process events from queue
  private async startEventProcessor(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const processEvents = async () => {
      while (this.processingQueue.length > 0) {
        const event = this.processingQueue.shift()!;
        await this.processEvent(event);
      }

      // Continue processing in next tick
      setTimeout(processEvents, 100);
    };

    processEvents();
  }

  private async processEvent(event: EventPayload): Promise<void> {
    const subscriptions = this.subscriptions.get(event.type) || [];

    // Sort by priority
    const sortedSubscriptions = subscriptions.sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      return priorityOrder[b.options.priority || 'normal'] - priorityOrder[a.options.priority || 'normal'];
    });

    const promises = sortedSubscriptions.map(sub => this.handleSubscription(event, sub));

    try {
      await Promise.allSettled(promises);

      logger.debug('Event processed successfully', {
        eventId: event.id,
        eventType: event.type,
        subscriberCount: subscriptions.length
      });

      // Emit event for additional listeners
      this.emit(event.type, event);
      this.emit('*', event); // Wildcard listener

    } catch (error) {
      logger.error('Event processing failed:', error, {
        eventId: event.id,
        eventType: event.type
      });
    }
  }

  private async handleSubscription(event: EventPayload, subscription: EventSubscription): Promise<void> {
    let attempts = 0;
    const maxRetries = subscription.options.maxRetries || 3;

    while (attempts <= maxRetries) {
      try {
        await subscription.handler(event);

        logger.debug('Event handled successfully', {
          eventId: event.id,
          subscriptionId: subscription.id,
          attempts: attempts + 1
        });

        return;
      } catch (error) {
        attempts++;

        logger.warn('Event handler failed', {
          eventId: event.id,
          subscriptionId: subscription.id,
          attempt: attempts,
          maxRetries,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        if (attempts > maxRetries) {
          if (subscription.options.deadLetterQueue) {
            this.addToDeadLetterQueue(event, subscription, error);
          }
          throw error;
        }

        // Exponential backoff
        await this.delay(Math.pow(2, attempts) * 1000);
      }
    }
  }

  private addToQueue(event: EventPayload): void {
    this.processingQueue.push(event);
  }

  private addToDeadLetterQueue(event: EventPayload, subscription: EventSubscription, error: any): void {
    const dlqEvent = {
      ...event,
      metadata: {
        ...event.metadata,
        deadLetterReason: error instanceof Error ? error.message : 'Unknown error',
        failedSubscription: subscription.id,
        addedToDLQ: new Date().toISOString()
      }
    };

    this.deadLetterQueue.push(dlqEvent);

    logger.error('Event added to dead letter queue', {
      eventId: event.id,
      subscriptionId: subscription.id,
      reason: dlqEvent.metadata.deadLetterReason
    });

    // Persist to cache
    cacheService.set(
      `dlq:${event.id}`,
      dlqEvent,
      { ttl: 604800, namespace: 'dead_letter' } // 7 days
    );
  }

  // Replay events from dead letter queue
  async replayDeadLetterEvents(): Promise<number> {
    const events = [...this.deadLetterQueue];
    let replayedCount = 0;

    for (const event of events) {
      try {
        this.addToQueue(event);

        // Remove from dead letter queue
        const index = this.deadLetterQueue.findIndex(e => e.id === event.id);
        if (index !== -1) {
          this.deadLetterQueue.splice(index, 1);
        }

        replayedCount++;

        logger.info('Dead letter event replayed', {
          eventId: event.id,
          eventType: event.type
        });
      } catch (error) {
        logger.error('Failed to replay dead letter event:', error, {
          eventId: event.id
        });
      }
    }

    return replayedCount;
  }

  // Get event statistics
  getEventStats(): any {
    return {
      subscriptionsCount: Array.from(this.subscriptions.values()).reduce((sum, subs) => sum + subs.length, 0),
      eventTypesCount: this.subscriptions.size,
      queueLength: this.processingQueue.length,
      deadLetterQueueLength: this.deadLetterQueue.length,
      eventHistorySize: this.eventHistory.size,
      uptime: process.uptime()
    };
  }

  // Get events by type
  async getEventsByType(eventType: string, limit: number = 100): Promise<EventPayload[]> {
    const events: EventPayload[] = [];

    for (const [id, event] of this.eventHistory.entries()) {
      if (event.type === eventType) {
        events.push(event);
      }
      if (events.length >= limit) break;
    }

    return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Utility methods
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clean up old events
  async cleanupOldEvents(maxAge: number = 86400000): Promise<number> { // 24 hours default
    const cutoff = Date.now() - maxAge;
    let cleanedCount = 0;

    for (const [id, event] of this.eventHistory.entries()) {
      if (event.timestamp.getTime() < cutoff) {
        this.eventHistory.delete(id);
        cleanedCount++;
      }
    }

    logger.info('Old events cleaned up', { cleanedCount });
    return cleanedCount;
  }
}

// Export singleton instance
export const eventBus = new EventBusService();

// Device-specific event types
export enum DeviceEvents {
  DEVICE_CONNECTED = 'device.connected',
  DEVICE_DISCONNECTED = 'device.disconnected',
  DEVICE_DATA_RECEIVED = 'device.data.received',
  DEVICE_ERROR = 'device.error',
  DEVICE_BATTERY_LOW = 'device.battery.low',
  DEVICE_OFFLINE = 'device.offline'
}

export enum SystemEvents {
  SYSTEM_STARTUP = 'system.startup',
  SYSTEM_SHUTDOWN = 'system.shutdown',
  CACHE_CONNECTED = 'cache.connected',
  CACHE_DISCONNECTED = 'cache.disconnected',
  DATABASE_CONNECTED = 'database.connected',
  DATABASE_ERROR = 'database.error'
}

// Start cleanup job
setInterval(() => {
  eventBus.cleanupOldEvents();
}, 3600000); // Every hour

export default eventBus;