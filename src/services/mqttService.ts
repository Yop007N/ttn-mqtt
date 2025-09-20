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
    logger.debug(`Message received on topic ${topic}`, {
        topic,
        messageLength: message.length,
        preview: message.substring(0, 100) + '...'
    });

    try {
        // PROBLEMA REAL: No validar que el mensaje sea JSON válido antes de parsear
        if (!message || message.trim().length === 0) {
            logger.warn('Empty MQTT message received', { topic });
            return;
        }

        const payload = JSON.parse(message);

        // PROBLEMA REAL: Estructura de validación muy rígida, TTN puede enviar diferentes tipos de mensajes
        // Primero identificar el tipo de mensaje
        const messageType = identifyMessageType(topic, payload);

        if (messageType === 'uplink') {
            await processUplinkMessage(payload, topic);
        } else if (messageType === 'downlink') {
            await processDownlinkMessage(payload, topic);
        } else if (messageType === 'join') {
            await processJoinMessage(payload, topic);
        } else {
            logger.debug('Unknown message type, skipping', { topic, messageType });
        }

    } catch (parseError) {
        // PROBLEMA REAL: Error de parsing JSON debe manejarse específicamente
        if (parseError instanceof SyntaxError) {
            logger.error('Invalid JSON in MQTT message', {
                topic,
                error: parseError.message,
                messagePreview: message.substring(0, 200)
            });
        } else {
            logger.error('Error processing MQTT message', {
                topic,
                error: parseError instanceof Error ? parseError.message : String(parseError),
                stack: parseError instanceof Error ? parseError.stack : undefined
            });
        }
    }
};

// NUEVO: Función para identificar tipo de mensaje
function identifyMessageType(topic: string, payload: any): string {
    if (topic.includes('/up') && payload.uplink_message) {
        return 'uplink';
    } else if (topic.includes('/down') && payload.downlink_message) {
        return 'downlink';
    } else if (topic.includes('/join') && payload.join_accept) {
        return 'join';
    }
    return 'unknown';
}

// NUEVO: Procesar mensajes uplink específicamente
async function processUplinkMessage(payload: any, topic: string): Promise<void> {
    // VALIDACIÓN ROBUSTA: Verificar estructura paso a paso
    if (!payload.end_device_ids?.device_id) {
        logger.warn('Uplink message missing device_id', { topic });
        return;
    }

    if (!payload.end_device_ids?.application_ids?.application_id) {
        logger.warn('Uplink message missing application_id', { topic, device_id: payload.end_device_ids.device_id });
        return;
    }

    // PROBLEMA REAL: Tu código asume que siempre hay decoded_payload.bytes, pero TTN no siempre lo incluye
    const frm_payload = payload.uplink_message?.frm_payload;
    const decoded_payload = payload.uplink_message?.decoded_payload;

    if (!frm_payload && !decoded_payload) {
        logger.debug('Uplink message without payload data, might be empty frame', {
            device_id: payload.end_device_ids.device_id,
            topic
        });
        return;
    }

    try {
        // Preparar datos más robustamente
        const deviceData = {
            device_id: payload.end_device_ids.device_id,
            application_id: payload.end_device_ids.application_ids.application_id,
            dev_eui: payload.end_device_ids.dev_eui || '',
            join_eui: payload.end_device_ids.join_eui || payload.end_device_ids.app_eui || '',
            decoded_payload_bytes: frm_payload ? Buffer.from(frm_payload, 'base64').toString('hex') : '',
            // NUEVO: Almacenar más información del uplink
            raw_payload: frm_payload ? Buffer.from(frm_payload, 'base64') : null,
            metadata: {
                received_at: payload.received_at,
                decoded_payload: decoded_payload,
                rx_metadata: payload.uplink_message?.rx_metadata,
                settings: payload.uplink_message?.settings,
                correlation_ids: payload.correlation_ids
            }
        };

        await storeDeviceData(deviceData);

        logger.info('Device uplink data stored successfully', {
            device_id: deviceData.device_id,
            application_id: deviceData.application_id,
            payload_size: deviceData.decoded_payload_bytes.length,
            has_decoded: !!decoded_payload
        });

    } catch (storeError) {
        logger.error('Failed to store device uplink data', {
            device_id: payload.end_device_ids.device_id,
            error: storeError instanceof Error ? storeError.message : String(storeError),
            topic
        });
    }
}

// NUEVO: Procesar mensajes downlink
async function processDownlinkMessage(payload: any, topic: string): Promise<void> {
    logger.info('Downlink message received', {
        device_id: payload.end_device_ids?.device_id,
        topic,
        correlation_ids: payload.correlation_ids
    });
    // Aquí podrías implementar lógica para rastrear comandos enviados
}

// NUEVO: Procesar mensajes de join
async function processJoinMessage(payload: any, topic: string): Promise<void> {
    logger.info('Device join message received', {
        device_id: payload.end_device_ids?.device_id,
        topic,
        session_key_id: payload.join_accept?.session_key_id
    });
    // Aquí podrías actualizar el estado del device como "joined"
}
