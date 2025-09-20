import { Sequelize } from 'sequelize';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  dialect: 'postgres' | 'mysql' | 'sqlite' | 'mariadb';
  logging: boolean;
  pool: {
    max: number;
    min: number;
    acquire: number;
    idle: number;
  };
}

interface MqttConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  topics: string[];
  clientId: string;
  reconnectPeriod: number;
  connectTimeout: number;
  keepalive: number;
  qos: 0 | 1 | 2;
}

interface ServerConfig {
  port: number;
  host: string;
  cors: {
    origin: string[];
    credentials: boolean;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
}

interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  format: 'json' | 'simple';
  fileRotation: boolean;
  maxFiles: number;
  maxSize: string;
}

interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  server: ServerConfig;
  database: DatabaseConfig;
  mqtt: MqttConfig;
  logging: LoggingConfig;
  health: {
    endpoint: string;
    timeout: number;
  };
  metrics: {
    enabled: boolean;
    endpoint: string;
  };
}

const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  return value || defaultValue!;
};

const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
};

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
};

export const config: AppConfig = {
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development',

  server: {
    port: getEnvNumber('PORT', 3000),
    host: getEnvVar('HOST', '0.0.0.0'),
    cors: {
      origin: getEnvVar('CORS_ORIGIN', '*').split(','),
      credentials: getEnvBoolean('CORS_CREDENTIALS', true),
    },
    rateLimit: {
      windowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      max: getEnvNumber('RATE_LIMIT_MAX', 100),
    },
  },

  database: {
    host: getEnvVar('DB_HOST', 'localhost'),
    port: getEnvNumber('DB_PORT', 5432),
    database: getEnvVar('DB_NAME', 'ttn_mqtt'),
    username: getEnvVar('DB_USERNAME', 'postgres'),
    password: getEnvVar('DB_PASSWORD', ''),
    dialect: 'postgres',
    logging: getEnvBoolean('DB_LOGGING', false),
    pool: {
      max: getEnvNumber('DB_POOL_MAX', 10),
      min: getEnvNumber('DB_POOL_MIN', 0),
      acquire: getEnvNumber('DB_POOL_ACQUIRE', 30000),
      idle: getEnvNumber('DB_POOL_IDLE', 10000),
    },
  },

  mqtt: {
    host: getEnvVar('MQTT_HOST', 'au1.cloud.thethings.network'),
    port: getEnvNumber('MQTT_PORT', 1883),
    username: getEnvVar('MQTT_USERNAME'),
    password: getEnvVar('MQTT_PASSWORD'),
    topics: getEnvVar('MQTT_TOPICS', 'v3/+/devices/+/up,v3/+/devices/+/down').split(','),
    clientId: getEnvVar('MQTT_CLIENT_ID', `ttn-mqtt-${Date.now()}`),
    reconnectPeriod: getEnvNumber('MQTT_RECONNECT_PERIOD', 5000),
    connectTimeout: getEnvNumber('MQTT_CONNECT_TIMEOUT', 30000),
    keepalive: getEnvNumber('MQTT_KEEPALIVE', 60),
    qos: (getEnvNumber('MQTT_QOS', 1) as MqttConfig['qos']),
  },

  logging: {
    level: (getEnvVar('LOG_LEVEL', 'info') as LoggingConfig['level']),
    format: (getEnvVar('LOG_FORMAT', 'json') as LoggingConfig['format']),
    fileRotation: getEnvBoolean('LOG_FILE_ROTATION', true),
    maxFiles: getEnvNumber('LOG_MAX_FILES', 5),
    maxSize: getEnvVar('LOG_MAX_SIZE', '20m'),
  },

  health: {
    endpoint: getEnvVar('HEALTH_ENDPOINT', '/health'),
    timeout: getEnvNumber('HEALTH_TIMEOUT', 5000),
  },

  metrics: {
    enabled: getEnvBoolean('METRICS_ENABLED', true),
    endpoint: getEnvVar('METRICS_ENDPOINT', '/metrics'),
  },
};

// Create Sequelize instance with enhanced configuration
const sequelize = new Sequelize(
  config.database.database,
  config.database.username,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: config.database.dialect,
    logging: config.database.logging,
    pool: config.database.pool,
    retry: {
      max: 3,
      timeout: 10000,
    },
    dialectOptions: {
      ssl: config.nodeEnv === 'production' ? { require: true, rejectUnauthorized: false } : false,
    },
  }
);

// Enhanced connection test with retry logic
export const testConnection = async (): Promise<void> => {
  let retries = 3;
  while (retries > 0) {
    try {
      await sequelize.authenticate();
      console.log('Database connection established successfully');
      return;
    } catch (error) {
      retries--;
      console.error(`Database connection failed. Retries left: ${retries}`, error);
      if (retries === 0) {
        throw new Error('Unable to connect to database after 3 attempts');
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

// Validate critical configuration
export const validateConfig = (): void => {
  const requiredEnvVars = ['MQTT_USERNAME', 'MQTT_PASSWORD'];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Required environment variable ${envVar} is not set`);
    }
  }

  if (![0, 1, 2].includes(config.mqtt.qos)) {
    throw new Error('MQTT_QOS must be 0, 1, or 2');
  }

  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLogLevels.includes(config.logging.level)) {
    throw new Error(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
  }
};

export { sequelize };
export default config;
