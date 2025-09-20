import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { cacheService } from '../services/cacheService';

/**
 * Advanced Circuit Breaker Implementation
 * Provides fault tolerance and resilience patterns for external service calls
 */

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  volumeThreshold: number;
  errorThresholdPercentage: number;
  slowCallThreshold?: number;
  slowCallDurationThreshold?: number;
  recordFailurePredicate?: (error: any) => boolean;
  recordSlowCallPredicate?: (duration: number) => boolean;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  callCount: number;
  slowCallCount: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttempt?: Date;
  errorRate: number;
  slowCallRate: number;
  uptime: number;
}

interface CallResult {
  success: boolean;
  duration: number;
  timestamp: Date;
  error?: any;
}

class CircuitBreaker extends EventEmitter {
  private name: string;
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private callCount: number = 0;
  private slowCallCount: number = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttempt?: Date;
  private options: CircuitBreakerOptions;
  private callHistory: CallResult[] = [];
  private stateChangeHistory: Array<{ state: CircuitState; timestamp: Date; reason: string }> = [];

  constructor(options: CircuitBreakerOptions) {
    super();
    this.name = options.name;
    this.options = {
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      monitoringPeriod: 60000, // 1 minute
      volumeThreshold: 10,
      errorThresholdPercentage: 50,
      slowCallThreshold: 10,
      slowCallDurationThreshold: 5000, // 5 seconds
      ...options
    };

    this.startMonitoring();
    this.emit('initialized', this.getStats());

    logger.info('Circuit breaker initialized', {
      name: this.name,
      options: this.options
    });
  }

  // Execute function with circuit breaker protection
  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    const startTime = Date.now();

    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (this.nextAttempt && Date.now() < this.nextAttempt.getTime()) {
        const error = new Error(`Circuit breaker '${this.name}' is OPEN`);
        this.emit('callRejected', { name: this.name, reason: 'circuit_open' });

        if (fallback) {
          logger.debug('Circuit breaker open, executing fallback', { name: this.name });
          return await fallback();
        }

        throw error;
      } else {
        // Try to transition to half-open
        this.transitionTo(CircuitState.HALF_OPEN, 'recovery_timeout_reached');
      }
    }

    // Execute the function
    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      await this.recordSuccess(duration);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      await this.recordFailure(error, duration);

      if (fallback) {
        logger.warn('Function failed, executing fallback', {
          name: this.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return await fallback();
      }

      throw error;
    }
  }

  // Record successful call
  private async recordSuccess(duration: number): Promise<void> {
    this.successCount++;
    this.callCount++;
    this.lastSuccessTime = new Date();

    const isSlowCall = this.isSlowCall(duration);
    if (isSlowCall) {
      this.slowCallCount++;
    }

    const callResult: CallResult = {
      success: true,
      duration,
      timestamp: new Date()
    };

    this.addToHistory(callResult);

    // Reset failure count on success (when not in half-open)
    if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Transition back to closed after successful call in half-open
      this.transitionTo(CircuitState.CLOSED, 'successful_call_in_half_open');
      this.failureCount = 0;
    }

    // Persist stats
    await this.persistStats();

    this.emit('callSuccess', {
      name: this.name,
      duration,
      slowCall: isSlowCall,
      stats: this.getStats()
    });

    logger.debug('Circuit breaker call succeeded', {
      name: this.name,
      duration,
      slowCall: isSlowCall,
      state: this.state
    });
  }

  // Record failed call
  private async recordFailure(error: any, duration: number): Promise<void> {
    // Check if this error should be recorded as a failure
    if (this.options.recordFailurePredicate && !this.options.recordFailurePredicate(error)) {
      logger.debug('Error not recorded as failure due to predicate', {
        name: this.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return;
    }

    this.failureCount++;
    this.callCount++;
    this.lastFailureTime = new Date();

    const isSlowCall = this.isSlowCall(duration);
    if (isSlowCall) {
      this.slowCallCount++;
    }

    const callResult: CallResult = {
      success: false,
      duration,
      timestamp: new Date(),
      error: error instanceof Error ? error.message : error
    };

    this.addToHistory(callResult);

    // Check if we should open the circuit
    if (this.shouldOpenCircuit()) {
      this.transitionTo(CircuitState.OPEN, 'failure_threshold_exceeded');
      this.nextAttempt = new Date(Date.now() + this.options.recoveryTimeout);
    }

    // Persist stats
    await this.persistStats();

    this.emit('callFailure', {
      name: this.name,
      error: error instanceof Error ? error.message : error,
      duration,
      slowCall: isSlowCall,
      stats: this.getStats()
    });

    logger.warn('Circuit breaker call failed', {
      name: this.name,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration,
      slowCall: isSlowCall,
      state: this.state,
      failureCount: this.failureCount
    });
  }

  // Check if call duration qualifies as slow
  private isSlowCall(duration: number): boolean {
    if (!this.options.slowCallDurationThreshold) return false;

    const isSlow = duration > this.options.slowCallDurationThreshold;

    if (this.options.recordSlowCallPredicate) {
      return this.options.recordSlowCallPredicate(duration);
    }

    return isSlow;
  }

  // Check if circuit should be opened
  private shouldOpenCircuit(): boolean {
    // Must have minimum volume
    if (this.callCount < this.options.volumeThreshold) {
      return false;
    }

    // Check failure threshold
    if (this.failureCount >= this.options.failureThreshold) {
      return true;
    }

    // Check error rate
    const errorRate = this.getErrorRate();
    if (errorRate >= this.options.errorThresholdPercentage) {
      return true;
    }

    // Check slow call rate if configured
    if (this.options.slowCallThreshold) {
      const slowCallRate = this.getSlowCallRate();
      if (this.slowCallCount >= this.options.slowCallThreshold ||
          slowCallRate >= this.options.errorThresholdPercentage) {
        return true;
      }
    }

    return false;
  }

  // Transition to new state
  private transitionTo(newState: CircuitState, reason: string): void {
    const oldState = this.state;
    this.state = newState;

    const stateChange = {
      state: newState,
      timestamp: new Date(),
      reason
    };

    this.stateChangeHistory.push(stateChange);

    // Keep only last 100 state changes
    if (this.stateChangeHistory.length > 100) {
      this.stateChangeHistory.shift();
    }

    logger.info('Circuit breaker state changed', {
      name: this.name,
      oldState,
      newState,
      reason
    });

    this.emit('stateChange', {
      name: this.name,
      oldState,
      newState,
      reason,
      stats: this.getStats()
    });
  }

  // Add call result to history
  private addToHistory(result: CallResult): void {
    this.callHistory.push(result);

    // Keep only calls within monitoring period
    const cutoff = Date.now() - this.options.monitoringPeriod;
    this.callHistory = this.callHistory.filter(
      call => call.timestamp.getTime() > cutoff
    );
  }

  // Start monitoring and cleanup
  private startMonitoring(): void {
    // Periodic cleanup and reset
    setInterval(() => {
      this.cleanupHistory();
      this.recalculateStats();
    }, this.options.monitoringPeriod);

    // Persist stats periodically
    setInterval(() => {
      this.persistStats();
    }, 30000); // Every 30 seconds
  }

  // Clean up old history entries
  private cleanupHistory(): void {
    const cutoff = Date.now() - this.options.monitoringPeriod;

    this.callHistory = this.callHistory.filter(
      call => call.timestamp.getTime() > cutoff
    );

    // Keep only recent state changes
    if (this.stateChangeHistory.length > 50) {
      this.stateChangeHistory = this.stateChangeHistory.slice(-50);
    }
  }

  // Recalculate stats from history
  private recalculateStats(): void {
    const recentCalls = this.callHistory;

    this.callCount = recentCalls.length;
    this.successCount = recentCalls.filter(call => call.success).length;
    this.failureCount = recentCalls.filter(call => !call.success).length;
    this.slowCallCount = recentCalls.filter(call =>
      this.isSlowCall(call.duration)
    ).length;

    // Update last success/failure times from history
    const successes = recentCalls.filter(call => call.success);
    const failures = recentCalls.filter(call => !call.success);

    if (successes.length > 0) {
      this.lastSuccessTime = successes[successes.length - 1].timestamp;
    }

    if (failures.length > 0) {
      this.lastFailureTime = failures[failures.length - 1].timestamp;
    }
  }

  // Calculate error rate
  private getErrorRate(): number {
    if (this.callCount === 0) return 0;
    return (this.failureCount / this.callCount) * 100;
  }

  // Calculate slow call rate
  private getSlowCallRate(): number {
    if (this.callCount === 0) return 0;
    return (this.slowCallCount / this.callCount) * 100;
  }

  // Get current statistics
  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      callCount: this.callCount,
      slowCallCount: this.slowCallCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttempt: this.nextAttempt,
      errorRate: this.getErrorRate(),
      slowCallRate: this.getSlowCallRate(),
      uptime: process.uptime()
    };
  }

  // Get detailed metrics
  getMetrics(): any {
    const now = Date.now();
    const recentCalls = this.callHistory.filter(
      call => call.timestamp.getTime() > (now - 60000) // Last minute
    );

    const avgDuration = recentCalls.length > 0
      ? recentCalls.reduce((sum, call) => sum + call.duration, 0) / recentCalls.length
      : 0;

    return {
      ...this.getStats(),
      averageResponseTime: Math.round(avgDuration),
      recentCallsCount: recentCalls.length,
      stateChangeHistory: this.stateChangeHistory.slice(-10), // Last 10 changes
      callHistory: this.callHistory.slice(-20) // Last 20 calls
    };
  }

  // Persist stats to cache
  private async persistStats(): Promise<void> {
    try {
      await cacheService.set(
        `circuit_breaker:${this.name}:stats`,
        this.getStats(),
        { ttl: 300, namespace: 'circuit_breakers' }
      );
    } catch (error) {
      logger.error('Failed to persist circuit breaker stats:', error, {
        name: this.name
      });
    }
  }

  // Force state change (for testing/admin purposes)
  forceState(state: CircuitState, reason: string = 'manual_override'): void {
    this.transitionTo(state, reason);

    if (state === CircuitState.OPEN) {
      this.nextAttempt = new Date(Date.now() + this.options.recoveryTimeout);
    } else if (state === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.nextAttempt = undefined;
    }

    logger.warn('Circuit breaker state forced', {
      name: this.name,
      state,
      reason
    });
  }

  // Reset circuit breaker
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.callCount = 0;
    this.slowCallCount = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.nextAttempt = undefined;
    this.callHistory = [];

    logger.info('Circuit breaker reset', { name: this.name });

    this.emit('reset', {
      name: this.name,
      stats: this.getStats()
    });
  }
}

// Circuit Breaker Manager
class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();

  // Create or get circuit breaker
  getCircuitBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const fullOptions: CircuitBreakerOptions = {
      name,
      failureThreshold: 5,
      recoveryTimeout: 60000,
      monitoringPeriod: 60000,
      volumeThreshold: 10,
      errorThresholdPercentage: 50,
      slowCallThreshold: 10,
      slowCallDurationThreshold: 5000,
      ...options
    };

    const breaker = new CircuitBreaker(fullOptions);
    this.breakers.set(name, breaker);

    logger.info('Circuit breaker created', { name, options: fullOptions });

    return breaker;
  }

  // Get all circuit breakers
  getAllBreakers(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  // Get circuit breaker stats
  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.values()).map(breaker => breaker.getStats());
  }

  // Remove circuit breaker
  removeCircuitBreaker(name: string): boolean {
    const removed = this.breakers.delete(name);
    if (removed) {
      logger.info('Circuit breaker removed', { name });
    }
    return removed;
  }

  // Reset all circuit breakers
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    logger.info('All circuit breakers reset');
  }
}

// Export singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();

// Common circuit breakers for the application
export const createDatabaseCircuitBreaker = () => {
  return circuitBreakerManager.getCircuitBreaker('database', {
    failureThreshold: 3,
    recoveryTimeout: 30000,
    volumeThreshold: 5,
    errorThresholdPercentage: 60,
    slowCallDurationThreshold: 3000
  });
};

export const createMqttCircuitBreaker = () => {
  return circuitBreakerManager.getCircuitBreaker('mqtt', {
    failureThreshold: 5,
    recoveryTimeout: 60000,
    volumeThreshold: 10,
    errorThresholdPercentage: 50,
    slowCallDurationThreshold: 10000
  });
};

export const createCacheCircuitBreaker = () => {
  return circuitBreakerManager.getCircuitBreaker('cache', {
    failureThreshold: 3,
    recoveryTimeout: 15000,
    volumeThreshold: 5,
    errorThresholdPercentage: 70,
    slowCallDurationThreshold: 1000
  });
};

export default CircuitBreaker;