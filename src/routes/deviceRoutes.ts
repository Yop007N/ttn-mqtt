import { Router } from 'express';
import { insertDeviceData, listDevices } from '../controllers/deviceController';

// Crea una instancia de Router de Express.
const router = Router();

/**
 * POST /api/devices
 * Ruta para insertar nuevos datos de dispositivo.
 * Delega al controlador `insertDeviceData` para procesar la solicitud.
 */
router.post('/devices', insertDeviceData);

/**
 * GET /api/devices
 * Ruta para obtener una lista de todos los dispositivos.
 * Delega al controlador `listDevices` para recuperar y devolver los datos.
 */
router.get('/devices', listDevices);


// Exporta el router configurado para ser utilizado en el punto de entrada principal de la aplicación.
export default router;
