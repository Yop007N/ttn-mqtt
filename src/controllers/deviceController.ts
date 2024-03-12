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
    // Extrae deviceId y data del cuerpo de la solicitud
    const { deviceId, data } = req.body;
    
    // Crea un nuevo registro de datos de dispositivo en la base de datos
    const newDeviceData = await Device.create({ deviceId, data });
    
    // Responde con el registro de datos del dispositivo y el estado HTTP 201
    return res.status(201).json(newDeviceData);
  } catch (error) {
    // Maneja cualquier error durante la inserción de datos y envía un mensaje de error
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
