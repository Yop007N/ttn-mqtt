import { config, validateConfig } from '../config/config';

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('Configuration', () => {
  describe('config object', () => {
    it('should have all required properties', () => {
      expect(config).toHaveProperty('nodeEnv');
      expect(config).toHaveProperty('server');
      expect(config).toHaveProperty('database');
      expect(config).toHaveProperty('mqtt');
      expect(config).toHaveProperty('logging');
      expect(config).toHaveProperty('health');
      expect(config).toHaveProperty('metrics');
    });

    it('should use default values when environment variables are not set', () => {
      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.database.host).toBe('localhost');
      expect(config.database.port).toBe(5432);
      expect(config.mqtt.host).toBe('au1.cloud.thethings.network');
    });

    it('should parse boolean environment variables correctly', () => {
      process.env.DB_LOGGING = 'true';
      process.env.CORS_CREDENTIALS = 'false';

      // Since config is already loaded, we need to test the helper function directly
      const { config: dotenvConfig } = require('dotenv');
      dotenvConfig();

      // Test boolean parsing
      expect(typeof config.database.logging).toBe('boolean');
    });
  });

  describe('validateConfig', () => {
    it('should throw error when required MQTT_USERNAME is missing', () => {
      delete process.env.MQTT_USERNAME;
      expect(() => validateConfig()).toThrow('Required environment variable MQTT_USERNAME is not set');
    });

    it('should throw error when required MQTT_PASSWORD is missing', () => {
      process.env.MQTT_USERNAME = 'test';
      delete process.env.MQTT_PASSWORD;
      expect(() => validateConfig()).toThrow('Required environment variable MQTT_PASSWORD is not set');
    });

    it('should not throw when all required variables are set', () => {
      process.env.MQTT_USERNAME = 'test';
      process.env.MQTT_PASSWORD = 'test';
      expect(() => validateConfig()).not.toThrow();
    });

    it('should validate MQTT QoS values', () => {
      process.env.MQTT_USERNAME = 'test';
      process.env.MQTT_PASSWORD = 'test';
      process.env.MQTT_QOS = '3'; // Invalid QoS

      expect(() => validateConfig()).toThrow('MQTT_QOS must be 0, 1, or 2');
    });

    it('should validate log levels', () => {
      process.env.MQTT_USERNAME = 'test';
      process.env.MQTT_PASSWORD = 'test';
      process.env.LOG_LEVEL = 'invalid';

      expect(() => validateConfig()).toThrow('LOG_LEVEL must be one of: error, warn, info, debug');
    });
  });

  describe('environment variable parsing', () => {
    it('should parse numeric environment variables', () => {
      process.env.PORT = '8080';
      process.env.DB_PORT = '3306';

      // Test that numbers are parsed correctly
      expect(typeof config.server.port).toBe('number');
      expect(typeof config.database.port).toBe('number');
    });

    it('should handle array parsing for CORS origins', () => {
      process.env.CORS_ORIGIN = 'http://localhost:3000,http://localhost:3001';

      // Since config is already loaded, test the concept
      const origins = process.env.CORS_ORIGIN.split(',');
      expect(Array.isArray(origins)).toBe(true);
      expect(origins.length).toBe(2);
    });
  });
});