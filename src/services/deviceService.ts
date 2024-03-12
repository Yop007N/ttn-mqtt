import { DeviceData } from '../types/deviceTypes';
import { Device } from '../models/deviceModel';
import { logger } from '../utils/logger';

/**
 * Almacena los datos de un dispositivo en la base de datos.
 * 
 * @param {DeviceData} deviceData - La información del dispositivo a almacenar.
 * @returns {Promise<Device>} Una promesa que se resuelve con el dispositivo recién creado.
 * @throws {Error} Si ocurre un error al guardar los datos en la base de datos.
 */
export const storeDeviceData = async (deviceData: DeviceData) => {
  try {
    const result = await Device.create(deviceData as any);
    logger.info(`Data stored successfully: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    logger.error('Error storing data: ' + error);
    throw error;
  }
};

/**
 * Recupera todos los dispositivos registrados en la base de datos.
 * 
 * @returns {Promise<Device[]>} Una promesa que se resuelve con un array de dispositivos.
 * @throws {Error} Si ocurre un error al recuperar los datos de la base de datos.
 */
export const getAllDevices = async () => {
  try {
    const devices = await Device.findAll();
    return devices;
  } catch (error) {
    logger.error('Error retrieving data: ' + error);
    throw error;
  }
};
