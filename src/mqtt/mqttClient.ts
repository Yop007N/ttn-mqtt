import * as mqtt from "mqtt";
import { processMqttMessage } from '../services/mqttService';
import { logger } from "../utils/logger";
import dotenv from "dotenv";

// Carga las variables de entorno del archivo .env en process.env
dotenv.config();

/**
 * Inicializa y configura el cliente MQTT para conectar con The Things Network (TTN)
 * y escuchar los mensajes entrantes.
 */
export const initializeMqttClient = () => {
  // Establece el puerto y la URL del broker MQTT a partir de las variables de entorno
  const MQTT_PORT = parseInt(process.env.MQTT_PORT || "1883", 10);
  const MQTT_URL = process.env.MQTT_URL || "au1.cloud.thethings.network";

  // Conecta al cliente MQTT con el broker utilizando las credenciales proporcionadas
  const mqttClient = mqtt.connect({
    host: MQTT_URL,
    port: MQTT_PORT,
    username: process.env.MQTT_USERNAME || "testdg@ttn",
    password: process.env.MQTT_PASSWORD || "your_password",
  });

  // Registra un manejador para el evento 'connect' que se dispara cuando el cliente se conecta al broker
  mqttClient.on("connect", () => {
    logger.info("Connected to TTN via MQTT");
    // Se suscribe al topic para recibir mensajes uplink de los dispositivos
    mqttClient.subscribe("v3/+/devices/+/up");
  });

  /**
   * Registra un manejador para el evento 'message' que se dispara cuando llega un mensaje.
   * 
   * @param {string} topic - El topic en el cual se recibió el mensaje.
   * @param {Buffer} message - El mensaje recibido como un Buffer.
   */
  mqttClient.on('message', (topic, message) => {
    // Procesa el mensaje recibido con la función del servicio MQTT
    processMqttMessage(topic, message.toString());
  });

  // Registra un manejador para el evento 'error' para manejar errores del cliente MQTT
  mqttClient.on("error", (error) =>
    logger.error(`MQTT client error: ${error instanceof Error ? error.message : String(error)}`)
  );

  // Registra un manejador para el evento 'reconnect' que se dispara cuando el cliente intenta reconectarse
  mqttClient.on("reconnect", () => logger.info("Reconnecting to MQTT broker..."));

  // Registra un manejador para el evento 'close' que se dispara cuando la conexión se cierra
  mqttClient.on("close", () => logger.info("MQTT client disconnected"));
};
