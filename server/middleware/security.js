// server/middleware/security.js
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('security');

/**
 * Enhanced security middleware configuration
 */
export const securityMiddleware = [
  // Helmet for security headers
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline", "fonts.googleapis.com"],
        fontSrc: ["'self'", "fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
  
  // Rate limiting for API endpoints
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  }),
];

/**
 * Stricter rate limiter for authentication endpoints
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 attempts per 15 minutes
  message: { error: 'Too many authentication attempts.' },
});

/**
 * Audit logging middleware
 */
export const auditLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Audit Log', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.session?.userId,
      timestamp: new Date().toISOString(),
    });
  });
  
  next();
};

/**
 * Sensitive data detection and sanitization
 */
export const detectSensitiveData = (data) => {
  const patterns = {
    apiKey: /api[_-]?key\s*[=:]\s*['"]?[a-zA-Z0-9]{20,}['"]?/gi,
    password: /password\s*[=:]\s*['"]?[^\s'"]+['"]?/gi,
    secret: /secret\s*[=:]\s*['"]?[a-zA-Z0-9]{16,}['"]?/gi,
    token: /token\s*[=:]\s*['"]?[a-zA-Z0-9._-]{20,}['"]?/gi,
    privateKey: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/gi,
    awsKey: /AKIA[0-9A-Z]{16}/gi,
    githubToken: /gh[pousr]_[A-Za-z0-9_]{36,}/gi,
  };
  
  const findings = [];
  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(data)) {
      findings.push({ type, detected: true });
    }
  }
  
  return findings;
};

/**
 * Repository access monitoring
 */
export const monitorRepoAccess = (req, res, next) => {
  if (req.path.includes('/repos/')) {
    logger.info('Repo Access', {
      action: req.method,
      path: req.path,
      userId: req.session?.userId,
      repoPath: req.body?.repoPath || req.query?.repoPath,
      timestamp: new Date().toISOString(),
    });
  }
  next();
};
