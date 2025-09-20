import { Router } from 'express';
import { insertDeviceData, listDevices } from '../../../../controllers/deviceController';
import { validateDevice, validateQueryParams } from '../middleware/validation';
import { rateLimiter } from '../middleware/rateLimiter';

/**
 * Device routes for API v1
 * Includes validation, rate limiting, and proper HTTP status codes
 */
const router = Router();

/**
 * POST /api/v1/devices
 * Create new device data with validation and rate limiting
 */
router.post('/',
  rateLimiter('device_creation', { max: 10, windowMs: 60000 }),
  validateDevice,
  insertDeviceData
);

/**
 * GET /api/v1/devices
 * Retrieve device list with pagination and filtering
 */
router.get('/',
  rateLimiter('device_list', { max: 100, windowMs: 60000 }),
  validateQueryParams,
  listDevices
);

/**
 * GET /api/v1/devices/:id
 * Retrieve specific device by ID
 */
router.get('/:id',
  rateLimiter('device_detail', { max: 200, windowMs: 60000 }),
  (req, res, next) => {
    // Individual device retrieval logic will be added later
    res.status(501).json({
      message: 'Individual device retrieval not implemented yet',
      version: 'v1'
    });
  }
);

export default router;