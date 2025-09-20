import * as mqtt from "mqtt";
import { processMqttMessage } from '../services/mqttService';
import { logger } from "../utils/logger";
import { config } from "../config/config";
import dotenv from "dotenv";

dotenv.config();

interface MqttConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  topics: string[];
  reconnectPeriod: number;
  connectTimeout: number;
  keepalive: number;
}

class MQTTClientManager {
  private client: mqtt.MqttClient | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private config: MqttConfig;

  constructor() {
    this.config = {
      host: process.env.MQTT_URL || "au1.cloud.thethings.network",
      port: parseInt(process.env.MQTT_PORT || "1883", 10),
      username: process.env.MQTT_USERNAME || "testdg@ttn",
      password: process.env.MQTT_PASSWORD || "",
      topics: ["v3/+/devices/+/up", "v3/+/devices/+/down"],
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      keepalive: 60,
    };
  }

  async initialize(): Promise<void> {
    if (this.client && this.isConnected) {
      logger.warn("MQTT client already initialized and connected");
      return;
    }

    try {
      await this.connect();
    } catch (error) {
      logger.error("Failed to initialize MQTT client:", error);
      throw error;
    }
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`Connecting to MQTT broker at ${this.config.host}:${this.config.port}`);

      this.client = mqtt.connect({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        reconnectPeriod: this.config.reconnectPeriod,
        connectTimeout: this.config.connectTimeout,
        keepalive: this.config.keepalive,
        clean: true,
        clientId: `ttn-mqtt-client-${Date.now()}`,
      });

      this.setupEventHandlers();

      const connectTimeout = setTimeout(() => {
        reject(new Error("MQTT connection timeout"));
      }, this.config.connectTimeout);

      this.client.on("connect", () => {
        clearTimeout(connectTimeout);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info("Successfully connected to TTN via MQTT");
        this.subscribeToTopics();
        resolve();
      });

      this.client.on("error", (error) => {
        clearTimeout(connectTimeout);
        logger.error(`MQTT connection error: ${error.message}`);
        reject(error);
      });
    });
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on("message", async (topic: string, message: Buffer) => {
      try {
        const messageStr = message.toString();
        logger.debug(`Received message on topic ${topic}: ${messageStr.substring(0, 100)}...`);
        await processMqttMessage(topic, messageStr);
      } catch (error) {
        logger.error(`Error processing MQTT message: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    this.client.on("reconnect", () => {
      this.reconnectAttempts++;
      logger.info(`Attempting MQTT reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        logger.error("Max reconnection attempts reached, stopping reconnection");
        this.client?.end(true);
      }
    });

    this.client.on("close", () => {
      this.isConnected = false;
      logger.info("MQTT client disconnected");
    });

    this.client.on("offline", () => {
      this.isConnected = false;
      logger.warn("MQTT client went offline");
    });

    this.client.on("error", (error) => {
      logger.error(`MQTT client error: ${error.message}`);
    });
  }

  private subscribeToTopics(): void {
    if (!this.client || !this.isConnected) return;

    this.config.topics.forEach((topic) => {
      this.client!.subscribe(topic, { qos: 1 }, (error) => {
        if (error) {
          logger.error(`Failed to subscribe to topic ${topic}: ${error.message}`);
        } else {
          logger.info(`Successfully subscribed to topic: ${topic}`);
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      return new Promise((resolve) => {
        this.client!.end(false, {}, () => {
          logger.info("MQTT client disconnected gracefully");
          resolve();
        });
      });
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected && this.client?.connected === true;
  }
}

// Singleton instance
const mqttClientManager = new MQTTClientManager();

export const initializeMqttClient = async (): Promise<void> => {
  await mqttClientManager.initialize();
};

export const disconnectMqttClient = async (): Promise<void> => {
  await mqttClientManager.disconnect();
};

export const getMqttConnectionStatus = (): boolean => {
  return mqttClientManager.getConnectionStatus();
};

export const mqttHealthCheck = async (): Promise<boolean> => {
  return mqttClientManager.healthCheck();
};
