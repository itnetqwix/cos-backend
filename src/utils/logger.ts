import { env } from '../config/env.js';

export const loggerConfig = {
  level: env.LOG_LEVEL || (env.NODE_ENV === 'development' ? 'debug' : 'info'),
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
};

export const logger = {
  info: (msg: string, ...args: unknown[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (env.NODE_ENV === 'development') {
      console.debug(`[DEBUG] ${msg}`, ...args);
    }
  },
};
