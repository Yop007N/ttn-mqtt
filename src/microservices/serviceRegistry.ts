import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { cacheService } from '../services/cacheService';

/**
 * Service Registry and Discovery for Microservices Architecture
 * Provides service registration, discovery, health checking, and load balancing
 */

export interface ServiceInstance {
  id: string;
  name: string;
  version: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'grpc' | 'mqtt';
  endpoints: ServiceEndpoint[];
  metadata: Record<string, any>;
  tags: string[];
  healthCheck?: HealthCheck;
  registeredAt: Date;
  lastHeartbeat: Date;
  status: ServiceStatus;
}

export interface ServiceEndpoint {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description?: string;
  version?: string;
  authenticated?: boolean;
  deprecated?: boolean;
}

export interface HealthCheck {
  endpoint: string;
  interval: number;
  timeout: number;
  retries: number;
  expectedStatus?: number;
  expectedResponse?: any;
}

export enum ServiceStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  STARTING = 'starting',
  STOPPING = 'stopping',
  CRITICAL = 'critical'
}

export interface ServiceFilter {
  name?: string;
  version?: string;
  tags?: string[];
  status?: ServiceStatus;
  metadata?: Record<string, any>;
}

export interface LoadBalancingStrategy {
  name: string;
  selectInstance: (instances: ServiceInstance[]) => ServiceInstance | null;
}

class ServiceRegistry extends EventEmitter {
  private services: Map<string, ServiceInstance> = new Map();
  private heartbeatInterval: number = 30000; // 30 seconds
  private healthCheckInterval: number = 60000; // 1 minute
  private serviceTimeouts: Map<string, number> = new Map();
  private loadBalancers: Map<string, LoadBalancingStrategy> = new Map();

  constructor() {
    super();
    this.initializeLoadBalancers();
    this.startHealthChecking();
    this.startCleanup();

    logger.info('Service registry initialized');
  }

  // Register a new service instance
  async registerService(service: Omit<ServiceInstance, 'id' | 'registeredAt' | 'lastHeartbeat' | 'status'>): Promise<string> {
    const serviceId = this.generateServiceId(service.name, service.host, service.port);

    const instance: ServiceInstance = {
      ...service,
      id: serviceId,
      registeredAt: new Date(),
      lastHeartbeat: new Date(),
      status: ServiceStatus.STARTING
    };

    this.services.set(serviceId, instance);

    // Cache service info
    await cacheService.set(
      `service:${serviceId}`,
      instance,
      { ttl: 300, namespace: 'services' }
    );

    // Set service timeout
    this.setServiceTimeout(serviceId);

    logger.info('Service registered', {
      serviceId,
      name: service.name,
      host: service.host,
      port: service.port,
      version: service.version
    });

    this.emit('serviceRegistered', instance);

    // Start health checking for this service
    if (instance.healthCheck) {
      this.scheduleHealthCheck(serviceId);
    }

    // Mark as healthy after initial registration
    setTimeout(() => {
      this.updateServiceStatus(serviceId, ServiceStatus.HEALTHY);
    }, 5000);

    return serviceId;
  }

  // Deregister a service instance
  async deregisterService(serviceId: string): Promise<boolean> {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    // Update status to stopping
    service.status = ServiceStatus.STOPPING;
    this.emit('serviceStatusChanged', service);

    // Remove from registry
    this.services.delete(serviceId);

    // Clear timeout
    const timeout = this.serviceTimeouts.get(serviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.serviceTimeouts.delete(serviceId);
    }

    // Remove from cache
    await cacheService.delete(`service:${serviceId}`, 'services');

    logger.info('Service deregistered', {
      serviceId,
      name: service.name
    });

    this.emit('serviceDeregistered', service);

    return true;
  }

  // Update service heartbeat
  async heartbeat(serviceId: string, metadata?: Record<string, any>): Promise<boolean> {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    service.lastHeartbeat = new Date();

    if (metadata) {
      service.metadata = { ...service.metadata, ...metadata };
    }

    // Reset timeout
    this.setServiceTimeout(serviceId);

    // Update cache
    await cacheService.set(
      `service:${serviceId}`,
      service,
      { ttl: 300, namespace: 'services' }
    );

    logger.debug('Service heartbeat received', {
      serviceId,
      name: service.name
    });

    return true;
  }

  // Discover services by criteria
  discoverServices(filter: ServiceFilter = {}): ServiceInstance[] {
    const allServices = Array.from(this.services.values());

    return allServices.filter(service => {
      // Filter by name
      if (filter.name && service.name !== filter.name) {
        return false;
      }

      // Filter by version
      if (filter.version && service.version !== filter.version) {
        return false;
      }

      // Filter by status
      if (filter.status && service.status !== filter.status) {
        return false;
      }

      // Filter by tags
      if (filter.tags && filter.tags.length > 0) {
        const hasAllTags = filter.tags.every(tag => service.tags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
      }

      // Filter by metadata
      if (filter.metadata) {
        for (const [key, value] of Object.entries(filter.metadata)) {
          if (service.metadata[key] !== value) {
            return false;
          }
        }
      }

      return true;
    });
  }

  // Get service instance with load balancing
  getServiceInstance(serviceName: string, strategy: string = 'round_robin'): ServiceInstance | null {
    const services = this.discoverServices({
      name: serviceName,
      status: ServiceStatus.HEALTHY
    });

    if (services.length === 0) {
      logger.warn('No healthy instances found for service', { serviceName });
      return null;
    }

    const loadBalancer = this.loadBalancers.get(strategy);
    if (!loadBalancer) {
      logger.warn('Unknown load balancing strategy, using round_robin', { strategy });
      return this.loadBalancers.get('round_robin')!.selectInstance(services);
    }

    return loadBalancer.selectInstance(services);
  }

  // Get all services grouped by name
  getAllServices(): Record<string, ServiceInstance[]> {
    const result: Record<string, ServiceInstance[]> = {};

    for (const service of this.services.values()) {
      if (!result[service.name]) {
        result[service.name] = [];
      }
      result[service.name].push(service);
    }

    return result;
  }

  // Get service statistics
  getStatistics(): any {
    const services = Array.from(this.services.values());
    const servicesByStatus = services.reduce((acc, service) => {
      acc[service.status] = (acc[service.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const servicesByName = services.reduce((acc, service) => {
      acc[service.name] = (acc[service.name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalServices: services.length,
      servicesByStatus,
      servicesByName,
      uniqueServices: Object.keys(servicesByName).length,
      uptime: process.uptime()
    };
  }

  // Update service status
  private updateServiceStatus(serviceId: string, status: ServiceStatus): void {
    const service = this.services.get(serviceId);
    if (!service) return;

    const oldStatus = service.status;
    service.status = status;

    if (oldStatus !== status) {
      logger.info('Service status changed', {
        serviceId,
        name: service.name,
        oldStatus,
        newStatus: status
      });

      this.emit('serviceStatusChanged', service);

      // Update cache
      cacheService.set(
        `service:${serviceId}`,
        service,
        { ttl: 300, namespace: 'services' }
      );
    }
  }

  // Set service timeout for automatic deregistration
  private setServiceTimeout(serviceId: string): void {
    // Clear existing timeout
    const existingTimeout = this.serviceTimeouts.get(serviceId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      const service = this.services.get(serviceId);
      if (service) {
        logger.warn('Service heartbeat timeout, marking as unhealthy', {
          serviceId,
          name: service.name
        });

        this.updateServiceStatus(serviceId, ServiceStatus.UNHEALTHY);
      }
    }, this.heartbeatInterval * 2) as any;

    this.serviceTimeouts.set(serviceId, timeout);
  }

  // Initialize load balancing strategies
  private initializeLoadBalancers(): void {
    // Round Robin Load Balancer
    let roundRobinIndex = 0;
    this.loadBalancers.set('round_robin', {
      name: 'Round Robin',
      selectInstance: (instances: ServiceInstance[]) => {
        if (instances.length === 0) return null;
        const instance = instances[roundRobinIndex % instances.length];
        roundRobinIndex++;
        return instance;
      }
    });

    // Random Load Balancer
    this.loadBalancers.set('random', {
      name: 'Random',
      selectInstance: (instances: ServiceInstance[]) => {
        if (instances.length === 0) return null;
        const index = Math.floor(Math.random() * instances.length);
        return instances[index];
      }
    });

    // Least Connections Load Balancer (simplified)
    this.loadBalancers.set('least_connections', {
      name: 'Least Connections',
      selectInstance: (instances: ServiceInstance[]) => {
        if (instances.length === 0) return null;
        // Simplified: return first instance (would track actual connections)
        return instances[0];
      }
    });

    // Weighted Load Balancer
    this.loadBalancers.set('weighted', {
      name: 'Weighted',
      selectInstance: (instances: ServiceInstance[]) => {
        if (instances.length === 0) return null;

        // Calculate weights based on metadata
        const weights = instances.map(instance =>
          instance.metadata.weight || 1
        );

        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let random = Math.random() * totalWeight;

        for (let i = 0; i < instances.length; i++) {
          random -= weights[i];
          if (random <= 0) {
            return instances[i];
          }
        }

        return instances[0];
      }
    });

    logger.info('Load balancing strategies initialized', {
      strategies: Array.from(this.loadBalancers.keys())
    });
  }

  // Start health checking
  private startHealthChecking(): void {
    setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  // Perform health checks on all services
  private async performHealthChecks(): Promise<void> {
    const services = Array.from(this.services.values())
      .filter(service => service.healthCheck && service.status !== ServiceStatus.STOPPING);

    const healthCheckPromises = services.map(service =>
      this.performHealthCheck(service).catch(error =>
        logger.error('Health check failed:', error, {
          serviceId: service.id,
          serviceName: service.name
        })
      )
    );

    await Promise.allSettled(healthCheckPromises);
  }

  // Perform health check on a single service
  private async performHealthCheck(service: ServiceInstance): Promise<void> {
    if (!service.healthCheck) return;

    const healthCheck = service.healthCheck;
    const url = `${service.protocol}://${service.host}:${service.port}${healthCheck.endpoint}`;

    try {
      // Simplified health check - would use actual HTTP client
      const isHealthy = await this.executeHealthCheck(url, healthCheck);

      if (isHealthy) {
        if (service.status === ServiceStatus.UNHEALTHY) {
          this.updateServiceStatus(service.id, ServiceStatus.HEALTHY);
          logger.info('Service recovered', {
            serviceId: service.id,
            serviceName: service.name
          });
        }
      } else {
        this.updateServiceStatus(service.id, ServiceStatus.UNHEALTHY);
        logger.warn('Service health check failed', {
          serviceId: service.id,
          serviceName: service.name,
          url
        });
      }

    } catch (error) {
      this.updateServiceStatus(service.id, ServiceStatus.UNHEALTHY);
      logger.error('Health check error:', error, {
        serviceId: service.id,
        serviceName: service.name,
        url
      });
    }
  }

  // Execute actual health check
  private async executeHealthCheck(url: string, healthCheck: HealthCheck): Promise<boolean> {
    // Simplified implementation - would use actual HTTP client like axios
    // For now, simulate health check
    const isHealthy = Math.random() > 0.1; // 90% success rate for simulation
    return isHealthy;
  }

  // Schedule health check for a specific service
  private scheduleHealthCheck(serviceId: string): void {
    const service = this.services.get(serviceId);
    if (!service || !service.healthCheck) return;

    const interval = service.healthCheck.interval || this.healthCheckInterval;

    setTimeout(() => {
      this.performHealthCheck(service);
      this.scheduleHealthCheck(serviceId); // Reschedule
    }, interval);
  }

  // Start cleanup process
  private startCleanup(): void {
    setInterval(() => {
      this.cleanupStaleServices();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  // Clean up stale services
  private cleanupStaleServices(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [serviceId, service] of this.services.entries()) {
      const timeSinceHeartbeat = now - service.lastHeartbeat.getTime();

      if (timeSinceHeartbeat > staleThreshold) {
        logger.warn('Removing stale service', {
          serviceId,
          serviceName: service.name,
          timeSinceHeartbeat
        });

        this.deregisterService(serviceId);
      }
    }
  }

  // Generate unique service ID
  private generateServiceId(name: string, host: string, port: number): string {
    return `${name}-${host}-${port}-${Date.now()}`;
  }

  // Export service configuration for service mesh
  exportServiceMesh(): any {
    const services = Array.from(this.services.values());

    return {
      services: services.map(service => ({
        name: service.name,
        version: service.version,
        endpoints: [`${service.host}:${service.port}`],
        protocol: service.protocol,
        healthCheck: service.healthCheck,
        metadata: service.metadata,
        tags: service.tags
      })),
      loadBalancingStrategies: Array.from(this.loadBalancers.keys()),
      registryMetadata: {
        totalServices: services.length,
        lastUpdate: new Date().toISOString()
      }
    };
  }
}

// Service Discovery Client
export class ServiceDiscoveryClient {
  private registry: ServiceRegistry;
  private serviceCache: Map<string, { instances: ServiceInstance[]; lastUpdate: number }> = new Map();
  private cacheTimeout: number = 30000; // 30 seconds

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
  }

  // Discover services with caching
  async discoverServices(serviceName: string, useCache: boolean = true): Promise<ServiceInstance[]> {
    if (useCache) {
      const cached = this.serviceCache.get(serviceName);
      if (cached && (Date.now() - cached.lastUpdate) < this.cacheTimeout) {
        return cached.instances;
      }
    }

    const instances = this.registry.discoverServices({ name: serviceName });

    // Update cache
    this.serviceCache.set(serviceName, {
      instances,
      lastUpdate: Date.now()
    });

    return instances;
  }

  // Get load-balanced service instance
  async getServiceInstance(serviceName: string, strategy: string = 'round_robin'): Promise<ServiceInstance | null> {
    const instances = await this.discoverServices(serviceName);

    if (instances.length === 0) {
      return null;
    }

    return this.registry.getServiceInstance(serviceName, strategy);
  }

  // Build service URL
  buildServiceUrl(instance: ServiceInstance, path: string = ''): string {
    return `${instance.protocol}://${instance.host}:${instance.port}${path}`;
  }
}

// Export singleton instance
export const serviceRegistry = new ServiceRegistry();
export const serviceDiscovery = new ServiceDiscoveryClient(serviceRegistry);

// Helper function to register current service
export const registerCurrentService = async (config: {
  name: string;
  version: string;
  port: number;
  endpoints?: ServiceEndpoint[];
  healthCheck?: HealthCheck;
  metadata?: Record<string, any>;
  tags?: string[];
}): Promise<string> => {
  const host = process.env.SERVICE_HOST || 'localhost';

  return await serviceRegistry.registerService({
    name: config.name,
    version: config.version,
    host,
    port: config.port,
    protocol: 'http',
    endpoints: config.endpoints || [],
    metadata: config.metadata || {},
    tags: config.tags || [],
    healthCheck: config.healthCheck
  });
};

export default serviceRegistry;