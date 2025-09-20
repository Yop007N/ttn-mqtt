// Importaciones de módulos necesarios y modelos
import { Request, Response } from 'express';
import { Device } from '../models/deviceModel';
import { getAllDevices } from '../services/deviceService';

/**
 * Inserta datos de un dispositivo en la base de datos.
 * 
 * @param {Request} req - El objeto de solicitud de Express.
 * @param {Response} res - El objeto de respuesta de Express.
 * @returns {Promise<Response>} Una promesa que resuelve a una respuesta de Express.
 */
export const insertDeviceData = async (req: Request, res: Response): Promise<Response> => {
  try {
    // PROBLEMA REAL: Estás usando { deviceId, data } pero tu modelo Device espera otros campos
    // Tu DeviceData interface requiere: device_id, application_id, dev_eui, join_eui, decoded_payload_bytes
    const { device_id, application_id, dev_eui, join_eui, decoded_payload_bytes, raw_payload, metadata } = req.body;

    // VALIDACIÓN REAL: Verificar campos obligatorios antes de crear
    if (!device_id || !application_id || !dev_eui || !join_eui || !decoded_payload_bytes) {
      return res.status(400).json({
        message: 'Missing required fields: device_id, application_id, dev_eui, join_eui, decoded_payload_bytes'
      });
    }

    // VALIDACIÓN: Verificar formato de EUIs (deben ser hexadecimal de 16 caracteres)
    if (!/^[0-9A-Fa-f]{16}$/.test(dev_eui) || !/^[0-9A-Fa-f]{16}$/.test(join_eui)) {
      return res.status(400).json({
        message: 'dev_eui and join_eui must be 16-character hexadecimal strings'
      });
    }

    // Crear con los datos correctos del modelo
    const deviceData = {
      device_id,
      application_id,
      dev_eui,
      join_eui,
      decoded_payload_bytes,
      raw_payload: raw_payload ? Buffer.from(raw_payload, 'base64') : null,
      metadata: metadata || {},
      is_active: true
    };

    const newDeviceData = await Device.create(deviceData);

    // Log del éxito con información específica
    logger.info('Device data inserted successfully', {
      device_id,
      application_id,
      id: newDeviceData.id
    });

    return res.status(201).json(newDeviceData);
  } catch (error) {
    // MANEJO MEJORADO: Distinguir entre errores de validación de Sequelize y otros errores
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        message: 'Validation error',
        errors: error.errors.map(e => ({ field: e.path, message: e.message }))
      });
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        message: 'Device with this device_id or dev_eui already exists'
      });
    }

    logger.error('Error inserting device data:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    return res.status(500).json({ message: errorMessage });
  }
};

/**
 * Lista todos los dispositivos almacenados en la base de datos.
 * 
 * @param {Request} req - El objeto de solicitud de Express.
 * @param {Response} res - El objeto de respuesta de Express.
 * @returns {Promise<Response>} Una promesa que resuelve a una respuesta de Express.
 */
export const listDevices = async (req: Request, res: Response): Promise<Response> => {
  try {
    // Obtiene todos los dispositivos de la base de datos
    const devices = await getAllDevices();
    
    // Responde con la lista de dispositivos y el estado HTTP 200
    return res.status(200).json(devices);
  } catch (error) {
    // Maneja cualquier error durante la recuperación de datos y envía un mensaje de error
    if (error instanceof Error) {
      return res.status(500).json({ message: error.message });
    } else {
      return res.status(500).json({ message: 'An unexpected error occurred' });
    }
  }
};
