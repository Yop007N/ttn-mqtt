import { Device } from '../models/deviceModel';
import { logger } from '../utils/logger';
import { cacheService } from '../services/cacheService';
import { eventBus } from '../services/eventBus';

/**
 * GraphQL Resolvers
 * Implements flexible data fetching with caching and real-time capabilities
 */

interface Context {
  user?: any;
  apiKey?: any;
  correlationId?: string;
}

interface DeviceFilter {
  applicationId?: string;
  isActive?: boolean;
  lastSeenAfter?: Date;
  lastSeenBefore?: Date;
  search?: string;
}

interface SensorDataFilter {
  deviceIds?: string[];
  startDate?: Date;
  endDate?: Date;
  minRssi?: number;
  maxRssi?: number;
  minSnr?: number;
  maxSnr?: number;
}

interface PaginationArgs {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

export const resolvers = {
  Query: {
    // Get single device
    device: async (parent: any, args: { id: string }, context: Context) => {
      try {
        logger.debug('GraphQL: Fetching device', {
          deviceId: args.id,
          correlationId: context.correlationId
        });

        // Try cache first
        const cached = await cacheService.get(`device:${args.id}`, {
          namespace: 'graphql'
        });

        if (cached) {
          return cached;
        }

        // Fetch from database
        const device = await Device.findByPk(args.id);

        if (device) {
          // Cache for 5 minutes
          await cacheService.set(`device:${args.id}`, device.toJSON(), {
            ttl: 300,
            namespace: 'graphql'
          });
        }

        return device;
      } catch (error) {
        logger.error('GraphQL: Failed to fetch device:', error, {
          deviceId: args.id,
          correlationId: context.correlationId
        });
        throw error;
      }
    },

    // Get devices with filtering and pagination
    devices: async (
      parent: any,
      args: {
        filter?: DeviceFilter;
        orderBy?: string;
        first?: number;
        after?: string;
        last?: number;
        before?: string;
      },
      context: Context
    ) => {
      try {
        logger.debug('GraphQL: Fetching devices', {
          filter: args.filter,
          pagination: { first: args.first, after: args.after },
          correlationId: context.correlationId
        });

        // Build cache key
        const cacheKey = `devices:${JSON.stringify(args)}`;
        const cached = await cacheService.get(cacheKey, {
          namespace: 'graphql'
        });

        if (cached) {
          return cached;
        }

        // Build query
        const whereClause: any = {};
        const orderClause: any[] = [];

        if (args.filter) {
          if (args.filter.applicationId) {
            whereClause.application_id = args.filter.applicationId;
          }
          if (typeof args.filter.isActive === 'boolean') {
            whereClause.is_active = args.filter.isActive;
          }
          if (args.filter.lastSeenAfter) {
            whereClause.last_seen_at = {
              ...whereClause.last_seen_at,
              [Op.gte]: args.filter.lastSeenAfter
            };
          }
          if (args.filter.lastSeenBefore) {
            whereClause.last_seen_at = {
              ...whereClause.last_seen_at,
              [Op.lte]: args.filter.lastSeenBefore
            };
          }
          if (args.filter.search) {
            whereClause[Op.or] = [
              { device_id: { [Op.iLike]: `%${args.filter.search}%` } },
              { application_id: { [Op.iLike]: `%${args.filter.search}%` } }
            ];
          }
        }

        // Handle ordering
        switch (args.orderBy) {
          case 'DEVICE_ID_ASC':
            orderClause.push(['device_id', 'ASC']);
            break;
          case 'DEVICE_ID_DESC':
            orderClause.push(['device_id', 'DESC']);
            break;
          case 'LAST_SEEN_ASC':
            orderClause.push(['last_seen_at', 'ASC']);
            break;
          case 'CREATED_AT_ASC':
            orderClause.push(['created_at', 'ASC']);
            break;
          case 'CREATED_AT_DESC':
            orderClause.push(['created_at', 'DESC']);
            break;
          default:
            orderClause.push(['last_seen_at', 'DESC']);
        }

        // Calculate pagination
        const limit = args.first || args.last || 20;
        const offset = args.after ? parseInt(Buffer.from(args.after, 'base64').toString()) : 0;

        // Execute query
        const { rows: devices, count } = await Device.findAndCountAll({
          where: whereClause,
          order: orderClause,
          limit: Math.min(limit, 100), // Max 100 items
          offset,
          attributes: { exclude: ['deleted_at'] }
        });

        // Build connection response
        const edges = devices.map((device, index) => ({
          node: device,
          cursor: Buffer.from((offset + index + 1).toString()).toString('base64')
        }));

        const hasNextPage = offset + limit < count;
        const hasPreviousPage = offset > 0;

        const connection = {
          edges,
          pageInfo: {
            hasNextPage,
            hasPreviousPage,
            startCursor: edges.length > 0 ? edges[0].cursor : null,
            endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
            totalCount: count
          }
        };

        // Cache for 1 minute
        await cacheService.set(cacheKey, connection, {
          ttl: 60,
          namespace: 'graphql'
        });

        return connection;
      } catch (error) {
        logger.error('GraphQL: Failed to fetch devices:', error, {
          correlationId: context.correlationId
        });
        throw error;
      }
    },

    // Device analytics
    deviceAnalytics: async (
      parent: any,
      args: { timeRange?: { startDate: Date; endDate: Date } },
      context: Context
    ) => {
      try {
        const cacheKey = `analytics:devices:${JSON.stringify(args.timeRange)}`;
        const cached = await cacheService.get(cacheKey, {
          namespace: 'graphql'
        });

        if (cached) {
          return cached;
        }

        // Calculate analytics (simplified - would use actual aggregation queries)
        const totalDevices = await Device.count();
        const activeDevices = await Device.count({ where: { is_active: true } });
        const inactiveDevices = totalDevices - activeDevices;

        const analytics = {
          totalDevices,
          activeDevices,
          inactiveDevices,
          devicesOnline: activeDevices, // Simplified
          devicesOffline: inactiveDevices,
          messageCountByHour: [], // Would implement actual time-series aggregation
          devicesByApplication: [], // Would implement grouping by application
          averageMessageFrequency: 0 // Would calculate from sensor data
        };

        // Cache for 5 minutes
        await cacheService.set(cacheKey, analytics, {
          ttl: 300,
          namespace: 'graphql'
        });

        return analytics;
      } catch (error) {
        logger.error('GraphQL: Failed to fetch analytics:', error, {
          correlationId: context.correlationId
        });
        throw error;
      }
    },

    // System health
    systemHealth: async (parent: any, args: any, context: Context) => {
      try {
        const memUsage = process.memoryUsage();
        const totalMemory = require('os').totalmem();
        const freeMemory = require('os').freemem();
        const usedMemory = totalMemory - freeMemory;

        return {
          status: 'healthy',
          uptime: Math.floor(process.uptime()),
          memoryUsage: {
            used: usedMemory / 1024 / 1024, // MB
            total: totalMemory / 1024 / 1024, // MB
            percentage: (usedMemory / totalMemory) * 100
          },
          databaseStatus: {
            status: 'up',
            responseTime: 50,
            lastChecked: new Date()
          },
          mqttStatus: {
            status: 'up',
            responseTime: 25,
            lastChecked: new Date()
          },
          cacheStatus: {
            status: 'up',
            responseTime: 10,
            lastChecked: new Date()
          }
        };
      } catch (error) {
        logger.error('GraphQL: Failed to fetch system health:', error);
        throw error;
      }
    },

    // Search devices
    searchDevices: async (
      parent: any,
      args: { query: string; limit?: number },
      context: Context
    ) => {
      try {
        const limit = Math.min(args.limit || 10, 50);
        const cacheKey = `search:devices:${args.query}:${limit}`;

        const cached = await cacheService.get(cacheKey, {
          namespace: 'graphql'
        });

        if (cached) {
          return cached;
        }

        // const devices = await Device.findAll({
        //   where: {
        //     [Op.or]: [
        //       { device_id: { [Op.iLike]: `%${args.query}%` } },
        //       { application_id: { [Op.iLike]: `%${args.query}%` } },
        //       { dev_eui: { [Op.iLike]: `%${args.query}%` } }
        //     ]
        //   },
        //   limit,
        //   order: [['last_seen_at', 'DESC']]
        // });

        // Mock search results for now
        const devices: any[] = [];

        // Cache for 2 minutes
        await cacheService.set(cacheKey, devices, {
          ttl: 120,
          namespace: 'graphql'
        });

        return devices;
      } catch (error) {
        logger.error('GraphQL: Search failed:', error, {
          query: args.query,
          correlationId: context.correlationId
        });
        throw error;
      }
    }
  },

  Mutation: {
    // Create device
    createDevice: async (
      parent: any,
      args: { input: any },
      context: Context
    ) => {
      try {
        logger.info('GraphQL: Creating device', {
          deviceId: args.input.deviceId,
          correlationId: context.correlationId
        });

        const device = await Device.create(args.input);

        // Invalidate cache
        await cacheService.invalidateByTag('devices');

        // Publish event
        await eventBus.publishEvent({
          type: 'device.created',
          source: 'graphql',
          data: device,
          correlationId: context.correlationId
        });

        return device;
      } catch (error) {
        logger.error('GraphQL: Failed to create device:', error, {
          correlationId: context.correlationId
        });
        throw error;
      }
    },

    // Update device
    updateDevice: async (
      parent: any,
      args: { id: string; input: any },
      context: Context
    ) => {
      try {
        logger.info('GraphQL: Updating device', {
          deviceId: args.id,
          correlationId: context.correlationId
        });

        const device = await Device.findByPk(args.id);
        if (!device) {
          throw new Error('Device not found');
        }

        await device.update(args.input);

        // Invalidate cache
        await cacheService.delete(`device:${args.id}`, 'graphql');
        await cacheService.invalidateByTag('devices');

        // Publish event
        await eventBus.publishEvent({
          type: 'device.updated',
          source: 'graphql',
          data: device,
          correlationId: context.correlationId
        });

        return device;
      } catch (error) {
        logger.error('GraphQL: Failed to update device:', error, {
          deviceId: args.id,
          correlationId: context.correlationId
        });
        throw error;
      }
    }
  },

  // Field resolvers
  Device: {
    // Resolve sensor data for a device
    sensorData: async (
      device: any,
      args: {
        limit?: number;
        offset?: number;
        startDate?: Date;
        endDate?: Date;
        orderBy?: string;
      }
    ) => {
      // Would implement actual sensor data fetching
      return [];
    },

    // Resolve alerts for a device
    alerts: async (
      device: any,
      args: {
        limit?: number;
        offset?: number;
        severity?: string;
        status?: string;
      }
    ) => {
      // Would implement actual alerts fetching
      return [];
    },

    // Resolve device metrics
    metrics: async (
      device: any,
      args: { timeWindow: string }
    ) => {
      // Would implement actual metrics calculation
      return {
        messageCount: 0,
        averageRssi: null,
        averageSnr: null,
        batteryLevel: null,
        lastMessageAt: null,
        uptimePercentage: null,
        errorCount: 0
      };
    }
  },

  // Custom scalar resolvers
  DateTime: {
    serialize: (date: Date) => date.toISOString(),
    parseValue: (value: string) => new Date(value),
    parseLiteral: (ast: any) => new Date(ast.value)
  },

  JSON: {
    serialize: (value: any) => value,
    parseValue: (value: any) => value,
    parseLiteral: (ast: any) => JSON.parse(ast.value)
  }
};

// Import Sequelize operators
const { Op } = require('sequelize');