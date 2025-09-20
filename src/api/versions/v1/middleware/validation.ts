import { Request, Response, NextFunction } from 'express';
import { body, query, validationResult } from 'express-validator';
import { logger } from '../../../../utils/logger';

/**
 * Advanced validation middleware for API v1
 * Provides comprehensive input validation and sanitization
 */

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorDetails = errors.array().map(error => ({
      field: error.type === 'field' ? error.path : error.type,
      message: error.msg,
      value: error.type === 'field' ? error.value : undefined,
      location: error.type === 'field' ? error.location : undefined
    }));

    logger.warn('Validation failed', {
      correlationId: req.correlationId,
      errors: errorDetails,
      endpoint: `${req.method} ${req.path}`,
      ip: req.ip
    });

    res.status(400).json({
      error: 'Validation failed',
      details: errorDetails,
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
      version: 'v1'
    });
    return;
  }

  next();
};

export const validateDevice = [
  body('device_id')
    .isString()
    .isLength({ min: 1, max: 255 })
    .trim()
    .escape()
    .withMessage('Device ID must be a string between 1 and 255 characters'),

  body('application_id')
    .isString()
    .isLength({ min: 1, max: 255 })
    .trim()
    .escape()
    .withMessage('Application ID must be a string between 1 and 255 characters'),

  body('dev_eui')
    .isHexadecimal()
    .isLength({ min: 16, max: 16 })
    .withMessage('Device EUI must be a 16-character hexadecimal string'),

  body('join_eui')
    .isHexadecimal()
    .isLength({ min: 16, max: 16 })
    .withMessage('Join EUI must be a 16-character hexadecimal string'),

  body('decoded_payload_bytes')
    .custom((value) => {
      try {
        if (typeof value === 'string') {
          JSON.parse(value);
        } else if (typeof value === 'object') {
          JSON.stringify(value);
        } else {
          throw new Error('Invalid payload format');
        }
        return true;
      } catch {
        throw new Error('Decoded payload must be valid JSON');
      }
    }),

  body('raw_payload')
    .optional()
    .isBase64()
    .withMessage('Raw payload must be valid base64'),

  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be a valid object'),

  handleValidationErrors
];

export const validateQueryParams = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Page must be an integer between 1 and 10000'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Limit must be an integer between 1 and 1000'),

  query('application_id')
    .optional()
    .isString()
    .isLength({ min: 1, max: 255 })
    .trim()
    .escape()
    .withMessage('Application ID must be a string between 1 and 255 characters'),

  query('is_active')
    .optional()
    .isBoolean()
    .withMessage('is_active must be a boolean value'),

  query('search')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 })
    .trim()
    .escape()
    .withMessage('Search query must be between 1 and 100 characters'),

  query('sort_by')
    .optional()
    .isIn(['created_at', 'updated_at', 'last_seen_at', 'device_id'])
    .withMessage('sort_by must be one of: created_at, updated_at, last_seen_at, device_id'),

  query('sort_order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('sort_order must be either asc or desc'),

  handleValidationErrors
];

export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  const sanitizeObject = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const sanitized: any = {};
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        sanitized[key] = obj[key].trim();
      } else if (typeof obj[key] === 'object') {
        sanitized[key] = sanitizeObject(obj[key]);
      } else {
        sanitized[key] = obj[key];
      }
    }
    return sanitized;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
};