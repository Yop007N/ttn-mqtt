import { Model, DataTypes, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../config/config';

/**
 * Enhanced Device model with optimized database schema and performance features
 */
export interface DeviceAttributes {
  id: number;
  device_id: string;
  application_id: string;
  dev_eui: string;
  join_eui: string;
  decoded_payload_bytes: string;
  raw_payload?: Buffer;
  last_seen_at?: Date;
  is_active: boolean;
  metadata?: any;
  created_at: Date;
  updated_at: Date;
}

export class Device extends Model<
  InferAttributes<Device>,
  InferCreationAttributes<Device>
> {
  declare id: CreationOptional<number>;
  declare device_id: string;
  declare application_id: string;
  declare dev_eui: string;
  declare join_eui: string;
  declare decoded_payload_bytes: string;
  declare raw_payload: CreationOptional<Buffer>;
  declare last_seen_at: CreationOptional<Date>;
  declare is_active: CreationOptional<boolean>;
  declare metadata: CreationOptional<any>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  // Instance methods
  public updateLastSeen(): Promise<Device> {
    return this.update({ last_seen_at: new Date() });
  }

  public setInactive(): Promise<Device> {
    return this.update({ is_active: false });
  }

  public setActive(): Promise<Device> {
    return this.update({ is_active: true });
  }

  // Static methods
  static async findByDeviceId(deviceId: string): Promise<Device | null> {
    return this.findOne({
      where: { device_id: deviceId },
      order: [['last_seen_at', 'DESC']],
    });
  }

  static async findActiveDevices(): Promise<Device[]> {
    return this.findAll({
      where: { is_active: true },
      order: [['last_seen_at', 'DESC']],
    });
  }

  static async findByApplication(applicationId: string): Promise<Device[]> {
    return this.findAll({
      where: { application_id: applicationId },
      order: [['created_at', 'DESC']],
    });
  }
}
// Initialize the model with enhanced schema and performance optimizations
Device.init({
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    device_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
          notEmpty: true,
          len: [1, 255],
        },
    },
    application_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 255],
        },
    },
    dev_eui: {
        type: DataTypes.STRING(16),
        allowNull: false,
        unique: true,
        validate: {
          isHexadecimal: true,
          len: [16, 16],
        },
    },
    join_eui: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
          isHexadecimal: true,
          len: [16, 16],
        },
    },
    decoded_payload_bytes: {
        type: DataTypes.TEXT,
        allowNull: false,
        get() {
          const value = this.getDataValue('decoded_payload_bytes');
          try {
            return value ? JSON.parse(value) : null;
          } catch {
            return value;
          }
        },
        set(value: any) {
          this.setDataValue('decoded_payload_bytes', typeof value === 'string' ? value : JSON.stringify(value));
        }
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
}, {
    tableName: 'devices',
    sequelize,
    timestamps: true,
    underscored: true,
    paranoid: true, // Soft deletes
    indexes: [
      {
        name: 'idx_device_id',
        fields: ['device_id'],
        unique: true,
      },
      {
        name: 'idx_dev_eui',
        fields: ['dev_eui'],
        unique: true,
      },
      {
        name: 'idx_application_id',
        fields: ['application_id'],
      },
      {
        name: 'idx_last_seen_at',
        fields: ['last_seen_at'],
      },
      {
        name: 'idx_is_active',
        fields: ['is_active'],
      },
      {
        name: 'idx_app_active',
        fields: ['application_id', 'is_active'],
      },
    ],
    hooks: {
      beforeUpdate: (device) => {
        device.updated_at = new Date();
      },
      afterCreate: (device) => {
        console.log(`New device created: ${device.device_id}`);
      },
      afterUpdate: (device) => {
        if (device.changed('is_active')) {
          console.log(`Device ${device.device_id} status changed to: ${device.is_active ? 'active' : 'inactive'}`);
        }
      },
    },
});

export default Device;
