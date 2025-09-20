import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { logger } from '../utils/logger';
import { eventBus, DeviceEvents, SystemEvents } from '../services/eventBus';
import { cacheService } from '../services/cacheService';

/**
 * WebSocket Server for Real-Time Communications
 * Provides live data streaming and bidirectional communication
 */

interface SocketClient {
  id: string;
  userId?: string;
  subscriptions: Set<string>;
  permissions: string[];
  lastSeen: Date;
  metadata?: Record<string, any>;
}

interface SubscriptionFilter {
  deviceIds?: string[];
  applicationIds?: string[];
  eventTypes?: string[];
  severity?: string[];
}

interface RoomPermissions {
  [roomName: string]: string[]; // Required permissions for each room
}

class WebSocketServer {
  private io: SocketIOServer;
  private clients: Map<string, SocketClient> = new Map();
  private roomPermissions: RoomPermissions = {
    'devices': ['read:devices'],
    'alerts': ['read:alerts'],
    'system': ['read:system'],
    'analytics': ['read:analytics'],
    'admin': ['admin']
  };

  constructor(httpServer: HttpServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.WEBSOCKET_CORS_ORIGIN || "*",
        methods: ["GET", "POST"],
        credentials: true
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      upgradeTimeout: 30000,
      maxHttpBufferSize: 1e6, // 1MB
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupEventBusSubscriptions();
    this.startHeartbeat();

    logger.info('WebSocket server initialized');
  }

  // Setup authentication and authorization middleware
  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization;

        if (!token) {
          return next(new Error('Authentication required'));
        }

        // Validate token (simplified - would use proper JWT validation)
        const isValid = await this.validateToken(token);
        if (!isValid) {
          return next(new Error('Invalid token'));
        }

        // Extract user info and permissions from token
        const userInfo = await this.extractUserInfo(token);
        socket.data.user = userInfo;
        socket.data.permissions = userInfo.permissions || [];

        logger.debug('WebSocket client authenticated', {
          socketId: socket.id,
          userId: userInfo.id,
          permissions: userInfo.permissions
        });

        next();
      } catch (error) {
        logger.error('WebSocket authentication failed:', error, {
          socketId: socket.id
        });
        next(new Error('Authentication failed'));
      }
    });
  }

  // Setup socket event handlers
  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);

      socket.on('subscribe', (data) => this.handleSubscribe(socket, data));
      socket.on('unsubscribe', (data) => this.handleUnsubscribe(socket, data));
      socket.on('device:command', (data) => this.handleDeviceCommand(socket, data));
      socket.on('analytics:request', (data) => this.handleAnalyticsRequest(socket, data));
      socket.on('heartbeat', () => this.handleHeartbeat(socket));
      socket.on('disconnect', (reason) => this.handleDisconnection(socket, reason));

      // Error handling
      socket.on('error', (error) => {
        logger.error('WebSocket error:', error, {
          socketId: socket.id,
          userId: socket.data.user?.id
        });
      });
    });
  }

  // Handle new client connection
  private handleConnection(socket: any): void {
    const client: SocketClient = {
      id: socket.id,
      userId: socket.data.user?.id,
      subscriptions: new Set(),
      permissions: socket.data.permissions || [],
      lastSeen: new Date(),
      metadata: {
        userAgent: socket.handshake.headers['user-agent'],
        ip: socket.handshake.address,
        connectedAt: new Date()
      }
    };

    this.clients.set(socket.id, client);

    logger.info('WebSocket client connected', {
      socketId: socket.id,
      userId: client.userId,
      totalClients: this.clients.size
    });

    // Send welcome message with server info
    socket.emit('connected', {
      message: 'Connected to TTN MQTT Gateway WebSocket',
      socketId: socket.id,
      serverTime: new Date().toISOString(),
      availableRooms: Object.keys(this.roomPermissions),
      permissions: client.permissions
    });

    // Join general room
    socket.join('general');

    // Publish connection event
    eventBus.publishEvent({
      type: 'websocket.client.connected',
      source: 'websocket_server',
      data: { socketId: socket.id, userId: client.userId }
    });
  }

  // Handle subscription requests
  private handleSubscribe(socket: any, data: { room: string; filters?: SubscriptionFilter }): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    try {
      const { room, filters } = data;

      // Check permissions
      const requiredPermissions = this.roomPermissions[room];
      if (requiredPermissions && !this.hasPermissions(client.permissions, requiredPermissions)) {
        socket.emit('subscription:error', {
          room,
          error: 'Insufficient permissions',
          requiredPermissions
        });
        return;
      }

      // Join room
      socket.join(room);
      client.subscriptions.add(room);

      // Store filters in cache for this client
      if (filters) {
        cacheService.set(
          `websocket:filters:${socket.id}:${room}`,
          filters,
          { ttl: 3600, namespace: 'websocket' }
        );
      }

      logger.info('Client subscribed to room', {
        socketId: socket.id,
        userId: client.userId,
        room,
        filters
      });

      socket.emit('subscription:success', {
        room,
        filters,
        message: `Subscribed to ${room}`
      });

      // Send recent data if available
      this.sendRecentData(socket, room, filters);

    } catch (error) {
      logger.error('Subscription failed:', error, {
        socketId: socket.id,
        room: data.room
      });

      socket.emit('subscription:error', {
        room: data.room,
        error: 'Subscription failed'
      });
    }
  }

  // Handle unsubscription requests
  private handleUnsubscribe(socket: any, data: { room: string }): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    const { room } = data;

    socket.leave(room);
    client.subscriptions.delete(room);

    // Remove filters
    cacheService.delete(`websocket:filters:${socket.id}:${room}`, 'websocket');

    logger.info('Client unsubscribed from room', {
      socketId: socket.id,
      userId: client.userId,
      room
    });

    socket.emit('unsubscription:success', {
      room,
      message: `Unsubscribed from ${room}`
    });
  }

  // Handle device commands
  private handleDeviceCommand(socket: any, data: { deviceId: string; command: string; parameters?: any }): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    try {
      // Check permissions
      if (!this.hasPermissions(client.permissions, ['write:devices'])) {
        socket.emit('command:error', {
          deviceId: data.deviceId,
          error: 'Insufficient permissions for device commands'
        });
        return;
      }

      logger.info('Device command received', {
        socketId: socket.id,
        userId: client.userId,
        deviceId: data.deviceId,
        command: data.command
      });

      // Publish command event
      eventBus.publishEvent({
        type: 'device.command.received',
        source: 'websocket_server',
        data: {
          deviceId: data.deviceId,
          command: data.command,
          parameters: data.parameters,
          requestedBy: client.userId,
          socketId: socket.id
        }
      });

      socket.emit('command:acknowledged', {
        deviceId: data.deviceId,
        command: data.command,
        status: 'queued'
      });

    } catch (error) {
      logger.error('Device command failed:', error, {
        socketId: socket.id,
        deviceId: data.deviceId
      });

      socket.emit('command:error', {
        deviceId: data.deviceId,
        error: 'Command processing failed'
      });
    }
  }

  // Handle analytics requests
  private handleAnalyticsRequest(socket: any, data: { type: string; parameters?: any }): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    try {
      // Check permissions
      if (!this.hasPermissions(client.permissions, ['read:analytics'])) {
        socket.emit('analytics:error', {
          type: data.type,
          error: 'Insufficient permissions for analytics'
        });
        return;
      }

      logger.debug('Analytics request received', {
        socketId: socket.id,
        userId: client.userId,
        type: data.type
      });

      // Process analytics request (would implement actual analytics)
      const analytics = this.generateAnalytics(data.type, data.parameters);

      socket.emit('analytics:data', {
        type: data.type,
        data: analytics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Analytics request failed:', error, {
        socketId: socket.id,
        type: data.type
      });

      socket.emit('analytics:error', {
        type: data.type,
        error: 'Analytics processing failed'
      });
    }
  }

  // Handle heartbeat
  private handleHeartbeat(socket: any): void {
    const client = this.clients.get(socket.id);
    if (client) {
      client.lastSeen = new Date();
    }

    socket.emit('heartbeat:ack', {
      timestamp: new Date().toISOString()
    });
  }

  // Handle client disconnection
  private handleDisconnection(socket: any, reason: string): void {
    const client = this.clients.get(socket.id);

    logger.info('WebSocket client disconnected', {
      socketId: socket.id,
      userId: client?.userId,
      reason,
      totalClients: this.clients.size - 1
    });

    // Clean up client data
    if (client) {
      // Remove filters from cache
      for (const room of client.subscriptions) {
        cacheService.delete(`websocket:filters:${socket.id}:${room}`, 'websocket');
      }

      this.clients.delete(socket.id);
    }

    // Publish disconnection event
    eventBus.publishEvent({
      type: 'websocket.client.disconnected',
      source: 'websocket_server',
      data: { socketId: socket.id, userId: client?.userId, reason }
    });
  }

  // Setup event bus subscriptions
  private setupEventBusSubscriptions(): void {
    // Device events
    eventBus.subscribe(DeviceEvents.DEVICE_CONNECTED, async (event) => {
      await this.broadcastToRoom('devices', 'device:connected', event.data);
    });

    eventBus.subscribe(DeviceEvents.DEVICE_DISCONNECTED, async (event) => {
      await this.broadcastToRoom('devices', 'device:disconnected', event.data);
    });

    eventBus.subscribe(DeviceEvents.DEVICE_DATA_RECEIVED, async (event) => {
      await this.broadcastToRoom('devices', 'device:data', event.data);
    });

    eventBus.subscribe(DeviceEvents.DEVICE_ERROR, async (event) => {
      await this.broadcastToRoom('alerts', 'device:error', event.data);
    });

    // System events
    eventBus.subscribe(SystemEvents.SYSTEM_STARTUP, async (event) => {
      await this.broadcastToRoom('system', 'system:startup', event.data);
    });

    eventBus.subscribe(SystemEvents.SYSTEM_SHUTDOWN, async (event) => {
      await this.broadcastToRoom('system', 'system:shutdown', event.data);
    });

    // Alert events
    eventBus.subscribe('alert.fired', async (event) => {
      await this.broadcastToRoom('alerts', 'alert:fired', event.data);
    });

    eventBus.subscribe('alert.resolved', async (event) => {
      await this.broadcastToRoom('alerts', 'alert:resolved', event.data);
    });

    logger.info('WebSocket event bus subscriptions established');
  }

  // Broadcast message to room with filtering
  private async broadcastToRoom(room: string, event: string, data: any): Promise<void> {
    try {
      // Get all sockets in the room
      const sockets = await this.io.in(room).fetchSockets();

      for (const socket of sockets) {
        const client = this.clients.get(socket.id);
        if (!client) continue;

        // Apply filters if they exist
        const filters = await cacheService.get(
          `websocket:filters:${socket.id}:${room}`,
          { namespace: 'websocket' }
        );

        if (filters && !this.passesFilter(data, filters)) {
          continue;
        }

        socket.emit(event, {
          data,
          timestamp: new Date().toISOString(),
          room
        });
      }

      logger.debug('Broadcast sent to room', {
        room,
        event,
        socketsCount: sockets.length
      });

    } catch (error) {
      logger.error('Broadcast failed:', error, {
        room,
        event
      });
    }
  }

  // Send recent data to newly subscribed client
  private async sendRecentData(socket: any, room: string, filters?: SubscriptionFilter): Promise<void> {
    try {
      let recentData: any = null;

      switch (room) {
        case 'devices':
          // Would fetch recent device data
          recentData = { message: 'Recent device data would be sent here' };
          break;
        case 'alerts':
          // Would fetch recent alerts
          recentData = { message: 'Recent alerts would be sent here' };
          break;
        case 'system':
          // Send current system status
          recentData = {
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
          };
          break;
      }

      if (recentData) {
        socket.emit(`${room}:recent`, {
          data: recentData,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.error('Failed to send recent data:', error, {
        socketId: socket.id,
        room
      });
    }
  }

  // Utility methods
  private async validateToken(token: string): Promise<boolean> {
    // Simplified token validation - would implement JWT validation
    return token.startsWith('valid_');
  }

  private async extractUserInfo(token: string): Promise<any> {
    // Simplified user extraction - would decode JWT
    return {
      id: 'user_123',
      name: 'Test User',
      permissions: ['read:devices', 'read:alerts', 'read:system']
    };
  }

  private hasPermissions(userPermissions: string[], requiredPermissions: string[]): boolean {
    return requiredPermissions.every(perm => userPermissions.includes(perm) || userPermissions.includes('admin'));
  }

  private passesFilter(data: any, filters: SubscriptionFilter): boolean {
    // Implement filtering logic based on the filters
    if (filters.deviceIds && data.deviceId && !filters.deviceIds.includes(data.deviceId)) {
      return false;
    }

    if (filters.applicationIds && data.applicationId && !filters.applicationIds.includes(data.applicationId)) {
      return false;
    }

    if (filters.severity && data.severity && !filters.severity.includes(data.severity)) {
      return false;
    }

    return true;
  }

  private generateAnalytics(type: string, parameters: any): any {
    // Mock analytics generation - would implement actual analytics
    return {
      type,
      parameters,
      result: 'Mock analytics data',
      generatedAt: new Date().toISOString()
    };
  }

  // Start heartbeat monitoring
  private startHeartbeat(): void {
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 5 * 60 * 1000; // 5 minutes

      for (const [socketId, client] of this.clients.entries()) {
        if (now - client.lastSeen.getTime() > staleThreshold) {
          logger.warn('Stale WebSocket client detected', {
            socketId,
            userId: client.userId,
            lastSeen: client.lastSeen
          });

          // Force disconnect stale clients
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.disconnect(true);
          }
        }
      }
    }, 60000); // Check every minute
  }

  // Get connection statistics
  getStats(): any {
    const rooms = new Map<string, number>();

    for (const client of this.clients.values()) {
      for (const room of client.subscriptions) {
        rooms.set(room, (rooms.get(room) || 0) + 1);
      }
    }

    return {
      totalClients: this.clients.size,
      roomSubscriptions: Object.fromEntries(rooms),
      uptime: process.uptime()
    };
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket server...');

    // Notify all clients
    this.io.emit('server:shutdown', {
      message: 'Server is shutting down',
      timestamp: new Date().toISOString()
    });

    // Close all connections
    this.io.close();

    logger.info('WebSocket server shutdown complete');
  }
}

export default WebSocketServer;