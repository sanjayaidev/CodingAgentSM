// server/utils/logger.js
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a Winston logger instance
 */
export const createLogger = (module) => {
  const transports = [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/audit.log'),
      level: 'info'
    }),
  ];
  
  // Add console transport in development
  if (process.env.NODE_ENV !== 'production') {
    transports.push(new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }));
  }
  
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: { module },
    transports,
  });
};

/**
 * Log levels:
 * error: Critical failures
 * warn: Warning messages
 * info: General operational information
 * debug: Detailed debugging information
 * verbose: Verbose logging
 * silly: Lowest priority logging
 */
