import { logger } from '../utils/logger';
import { storeDeviceData } from './deviceService';

/**
 * Procesa los mensajes MQTT recibidos.
 * Esta función se invoca cada vez que se recibe un mensaje en los topics suscritos por el cliente MQTT.
 * 
 * @param {string} topic - El topic MQTT en el que se recibió el mensaje.
 * @param {string} message - El mensaje recibido en formato de cadena.
 * 
 * La función intenta parsear el mensaje JSON para extraer los datos del dispositivo.
 * Si el mensaje es válido, procede a almacenar los datos del dispositivo utilizando `storeDeviceData`.
 * En caso de error en el parseo o si faltan datos necesarios en el payload, se registra un error.
 */
export const processMqttMessage = async (topic: string, message: string) => {
    console.log(`Mensaje recibido en el topic ${topic}: ${message}`);
    try {
        // Intenta parsear el mensaje como un objeto JSON
        const payload = JSON.parse(message);
        console.log('Carga útil parseada:', payload);

        // Verifica que el payload contenga los identificadores del dispositivo
        if (!payload.end_device_ids || !payload.end_device_ids.device_id) {
            throw new Error('Payload no contiene todos los datos necesarios.');
        }

        // Verifica que el payload contenga los datos decodificados esperados
        if (!payload.uplink_message.decoded_payload || !payload.uplink_message.decoded_payload.bytes) {
            throw new Error('decoded_payload.bytes no está definido en la carga útil');
        }

        // Prepara los datos del dispositivo para ser almacenados
        const deviceData = {
            device_id: payload.end_device_ids.device_id,
            application_id: payload.end_device_ids.application_ids.application_id,
            dev_eui: payload.end_device_ids.dev_eui,
            join_eui: payload.end_device_ids.join_eui,
            decoded_payload_bytes: Buffer.from(payload.uplink_message.frm_payload, 'base64').toString('hex')
        };

        // Almacena los datos del dispositivo
        await storeDeviceData(deviceData);
        logger.info(`Datos almacenados con éxito para el dispositivo: ${deviceData.device_id}`);
    } catch (error) {
        // Registra un error si ocurre algún problema al procesar el mensaje
        logger.error(`Error al procesar el mensaje MQTT: ${error instanceof Error ? error.message : String(error)}`);
    }
};
