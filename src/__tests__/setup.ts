// Jest setup file for test configuration

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MQTT_USERNAME = 'test_user';
process.env.MQTT_PASSWORD = 'test_password';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'test_db';
process.env.DB_USERNAME = 'test_user';
process.env.DB_PASSWORD = 'test_password';

// Mock console methods to avoid noise in tests
const originalConsole = global.console;

beforeAll(() => {
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterAll(() => {
  global.console = originalConsole;
});

// Global test utilities
global.testUtils = {
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  mockMqttClient: {
    connected: true,
    connect: jest.fn(),
    subscribe: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },

  mockSequelize: {
    authenticate: jest.fn().mockResolvedValue(true),
    sync: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(true),
  },
};

// Extend Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidTimestamp(): R;
      toHaveValidHealthStatus(): R;
    }
  }

  var testUtils: {
    delay: (ms: number) => Promise<void>;
    mockMqttClient: any;
    mockSequelize: any;
  };
}

// Custom Jest matchers
expect.extend({
  toBeValidTimestamp(received) {
    const pass = !isNaN(Date.parse(received));
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid timestamp`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid timestamp`,
        pass: false,
      };
    }
  },

  toHaveValidHealthStatus(received) {
    const validStatuses = ['healthy', 'unhealthy', 'degraded'];
    const pass = validStatuses.includes(received.status);
    if (pass) {
      return {
        message: () => `expected ${received.status} not to be a valid health status`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received.status} to be one of: ${validStatuses.join(', ')}`,
        pass: false,
      };
    }
  },
});