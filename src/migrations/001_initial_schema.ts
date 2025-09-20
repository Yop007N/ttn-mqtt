import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Initial database schema migration
 * Creates the foundational tables for the TTN MQTT Gateway
 */
export const up = async (queryInterface: QueryInterface): Promise<void> => {
  // Create devices table
  await queryInterface.createTable('devices', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    device_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    application_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    dev_eui: {
      type: DataTypes.STRING(16),
      allowNull: false,
      unique: true,
    },
    join_eui: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    decoded_payload_bytes: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    raw_payload: {
      type: DataTypes.BLOB,
      allowNull: true,
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  // Create indexes for devices table
  await queryInterface.addIndex('devices', ['device_id'], {
    unique: true,
    name: 'idx_device_id',
  });

  await queryInterface.addIndex('devices', ['dev_eui'], {
    unique: true,
    name: 'idx_dev_eui',
  });

  await queryInterface.addIndex('devices', ['application_id'], {
    name: 'idx_application_id',
  });

  await queryInterface.addIndex('devices', ['last_seen_at'], {
    name: 'idx_last_seen_at',
  });

  await queryInterface.addIndex('devices', ['is_active'], {
    name: 'idx_is_active',
  });

  await queryInterface.addIndex('devices', ['application_id', 'is_active'], {
    name: 'idx_app_active',
  });

  // Create sensor_data table for time-series data
  await queryInterface.createTable('sensor_data', {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'devices',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    received_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    raw_payload: {
      type: DataTypes.BLOB,
      allowNull: true,
    },
    rssi: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    snr: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    frequency: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    data_rate: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    gateway_info: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  // Create indexes for sensor_data table (optimized for time-series queries)
  await queryInterface.addIndex('sensor_data', ['device_id'], {
    name: 'idx_sensor_data_device_id',
  });

  await queryInterface.addIndex('sensor_data', ['received_at'], {
    name: 'idx_sensor_data_received_at',
  });

  await queryInterface.addIndex('sensor_data', ['device_id', 'received_at'], {
    name: 'idx_sensor_data_device_time',
  });

  // Create device_alerts table
  await queryInterface.createTable('device_alerts', {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'devices',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    alert_type: {
      type: DataTypes.ENUM('battery_low', 'offline', 'error', 'threshold_exceeded', 'custom'),
      allowNull: false,
    },
    severity: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
      allowNull: false,
      defaultValue: 'medium',
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    alert_data: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    acknowledged: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    acknowledged_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    acknowledged_by: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    resolved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  // Create indexes for device_alerts table
  await queryInterface.addIndex('device_alerts', ['device_id'], {
    name: 'idx_device_alerts_device_id',
  });

  await queryInterface.addIndex('device_alerts', ['alert_type'], {
    name: 'idx_device_alerts_type',
  });

  await queryInterface.addIndex('device_alerts', ['severity'], {
    name: 'idx_device_alerts_severity',
  });

  await queryInterface.addIndex('device_alerts', ['acknowledged'], {
    name: 'idx_device_alerts_acknowledged',
  });

  await queryInterface.addIndex('device_alerts', ['created_at'], {
    name: 'idx_device_alerts_created_at',
  });

  // Create api_keys table for authentication
  await queryInterface.createTable('api_keys', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    key_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    permissions: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    rate_limit: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1000,
    },
    last_used_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_by: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  // Create indexes for api_keys table
  await queryInterface.addIndex('api_keys', ['key_hash'], {
    unique: true,
    name: 'idx_api_keys_hash',
  });

  await queryInterface.addIndex('api_keys', ['is_active'], {
    name: 'idx_api_keys_active',
  });

  await queryInterface.addIndex('api_keys', ['expires_at'], {
    name: 'idx_api_keys_expires',
  });
};

export const down = async (queryInterface: QueryInterface): Promise<void> => {
  // Drop tables in reverse order (respecting foreign key constraints)
  await queryInterface.dropTable('api_keys');
  await queryInterface.dropTable('device_alerts');
  await queryInterface.dropTable('sensor_data');
  await queryInterface.dropTable('devices');
};