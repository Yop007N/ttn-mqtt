import { buildSchema } from 'graphql';

/**
 * GraphQL Schema Definition
 * Provides flexible data querying capabilities for IoT device management
 */

export const typeDefs = `
  scalar DateTime
  scalar JSON

  # Device Types
  type Device {
    id: ID!
    deviceId: String!
    applicationId: String!
    devEui: String!
    joinEui: String!
    decodedPayloadBytes: JSON
    rawPayload: String
    lastSeenAt: DateTime
    isActive: Boolean!
    metadata: JSON
    createdAt: DateTime!
    updatedAt: DateTime!

    # Relationships
    sensorData(
      limit: Int = 10
      offset: Int = 0
      startDate: DateTime
      endDate: DateTime
      orderBy: SensorDataOrderBy = RECEIVED_AT_DESC
    ): [SensorData!]!

    alerts(
      limit: Int = 10
      offset: Int = 0
      severity: AlertSeverity
      status: AlertStatus
    ): [DeviceAlert!]!

    # Aggregated data
    metrics(timeWindow: TimeWindow!): DeviceMetrics!
  }

  type SensorData {
    id: ID!
    deviceId: ID!
    receivedAt: DateTime!
    payload: JSON!
    rawPayload: String
    rssi: Int
    snr: Float
    frequency: Float
    dataRate: String
    gatewayInfo: JSON
    createdAt: DateTime!

    # Relationships
    device: Device!
  }

  type DeviceAlert {
    id: ID!
    deviceId: ID!
    alertType: AlertType!
    severity: AlertSeverity!
    message: String!
    alertData: JSON
    acknowledged: Boolean!
    acknowledgedAt: DateTime
    acknowledgedBy: String
    resolved: Boolean!
    resolvedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!

    # Relationships
    device: Device!
  }

  type DeviceMetrics {
    messageCount: Int!
    averageRssi: Float
    averageSnr: Float
    batteryLevel: Float
    lastMessageAt: DateTime
    uptimePercentage: Float
    errorCount: Int!
  }

  # API Keys for authentication
  type ApiKey {
    id: ID!
    name: String!
    permissions: [String!]!
    rateLimit: Int!
    lastUsedAt: DateTime
    expiresAt: DateTime
    isActive: Boolean!
    createdBy: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # Enums
  enum AlertType {
    BATTERY_LOW
    OFFLINE
    ERROR
    THRESHOLD_EXCEEDED
    CUSTOM
  }

  enum AlertSeverity {
    LOW
    MEDIUM
    HIGH
    CRITICAL
  }

  enum AlertStatus {
    OPEN
    ACKNOWLEDGED
    RESOLVED
  }

  enum SensorDataOrderBy {
    RECEIVED_AT_ASC
    RECEIVED_AT_DESC
    RSSI_ASC
    RSSI_DESC
    SNR_ASC
    SNR_DESC
  }

  enum TimeWindow {
    LAST_HOUR
    LAST_DAY
    LAST_WEEK
    LAST_MONTH
    CUSTOM
  }

  enum DeviceOrderBy {
    DEVICE_ID_ASC
    DEVICE_ID_DESC
    LAST_SEEN_ASC
    LAST_SEEN_DESC
    CREATED_AT_ASC
    CREATED_AT_DESC
  }

  # Input Types
  input DeviceFilter {
    applicationId: String
    isActive: Boolean
    lastSeenAfter: DateTime
    lastSeenBefore: DateTime
    search: String
  }

  input SensorDataFilter {
    deviceIds: [ID!]
    startDate: DateTime
    endDate: DateTime
    minRssi: Int
    maxRssi: Int
    minSnr: Float
    maxSnr: Float
  }

  input CreateDeviceInput {
    deviceId: String!
    applicationId: String!
    devEui: String!
    joinEui: String!
    decodedPayloadBytes: JSON!
    rawPayload: String
    metadata: JSON
  }

  input UpdateDeviceInput {
    deviceId: String
    applicationId: String
    devEui: String
    joinEui: String
    decodedPayloadBytes: JSON
    rawPayload: String
    isActive: Boolean
    metadata: JSON
  }

  input CreateAlertInput {
    deviceId: ID!
    alertType: AlertType!
    severity: AlertSeverity!
    message: String!
    alertData: JSON
  }

  input TimeRangeInput {
    startDate: DateTime!
    endDate: DateTime!
  }

  # Pagination
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
    totalCount: Int!
  }

  type DeviceConnection {
    edges: [DeviceEdge!]!
    pageInfo: PageInfo!
  }

  type DeviceEdge {
    node: Device!
    cursor: String!
  }

  type SensorDataConnection {
    edges: [SensorDataEdge!]!
    pageInfo: PageInfo!
  }

  type SensorDataEdge {
    node: SensorData!
    cursor: String!
  }

  # Analytics Types
  type DeviceAnalytics {
    totalDevices: Int!
    activeDevices: Int!
    inactiveDevices: Int!
    devicesOnline: Int!
    devicesOffline: Int!
    messageCountByHour: [HourlyCount!]!
    devicesByApplication: [ApplicationCount!]!
    averageMessageFrequency: Float!
  }

  type HourlyCount {
    hour: DateTime!
    count: Int!
  }

  type ApplicationCount {
    applicationId: String!
    count: Int!
  }

  type SystemHealth {
    status: String!
    uptime: Int!
    memoryUsage: MemoryUsage!
    databaseStatus: ServiceStatus!
    mqttStatus: ServiceStatus!
    cacheStatus: ServiceStatus!
  }

  type MemoryUsage {
    used: Float!
    total: Float!
    percentage: Float!
  }

  type ServiceStatus {
    status: String!
    responseTime: Float
    lastChecked: DateTime!
  }

  # Queries
  type Query {
    # Device queries
    device(id: ID!): Device
    devices(
      filter: DeviceFilter
      orderBy: DeviceOrderBy = LAST_SEEN_DESC
      first: Int
      after: String
      last: Int
      before: String
    ): DeviceConnection!

    # Sensor data queries
    sensorData(
      filter: SensorDataFilter
      orderBy: SensorDataOrderBy = RECEIVED_AT_DESC
      first: Int
      after: String
      last: Int
      before: String
    ): SensorDataConnection!

    # Analytics queries
    deviceAnalytics(timeRange: TimeRangeInput): DeviceAnalytics!

    # System queries
    systemHealth: SystemHealth!

    # Alert queries
    alerts(
      deviceId: ID
      severity: AlertSeverity
      status: AlertStatus
      limit: Int = 20
      offset: Int = 0
    ): [DeviceAlert!]!

    # Search
    searchDevices(query: String!, limit: Int = 10): [Device!]!

    # API Key queries (requires admin permissions)
    apiKeys: [ApiKey!]! @auth(requires: ADMIN)
  }

  # Mutations
  type Mutation {
    # Device mutations
    createDevice(input: CreateDeviceInput!): Device! @auth(requires: WRITE)
    updateDevice(id: ID!, input: UpdateDeviceInput!): Device! @auth(requires: WRITE)
    deleteDevice(id: ID!): Boolean! @auth(requires: ADMIN)

    # Alert mutations
    createAlert(input: CreateAlertInput!): DeviceAlert! @auth(requires: WRITE)
    acknowledgeAlert(id: ID!, acknowledgedBy: String): DeviceAlert! @auth(requires: WRITE)
    resolveAlert(id: ID!): DeviceAlert! @auth(requires: WRITE)

    # API Key mutations (requires admin permissions)
    createApiKey(name: String!, permissions: [String!]!, rateLimit: Int): ApiKey! @auth(requires: ADMIN)
    revokeApiKey(id: ID!): Boolean! @auth(requires: ADMIN)
  }

  # Subscriptions for real-time updates
  type Subscription {
    # Device subscriptions
    deviceConnected: Device!
    deviceDisconnected: Device!
    deviceDataReceived(deviceId: ID): SensorData!

    # Alert subscriptions
    alertFired(severity: AlertSeverity): DeviceAlert!
    alertResolved: DeviceAlert!

    # System subscriptions
    systemHealthUpdated: SystemHealth!
  }

  # Custom directives
  directive @auth(requires: Permission!) on FIELD_DEFINITION

  enum Permission {
    READ
    WRITE
    ADMIN
  }
`;

export const schema = buildSchema(typeDefs);