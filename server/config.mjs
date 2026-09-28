import { randomBytes } from 'node:crypto';
export const config = {
  production: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  origin: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  database: process.env.DATABASE_PATH || './data/dotcloser.sqlite',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  trialDays: Number(process.env.TRIAL_DAYS || 7),
  trialLimit: Number(process.env.TRIAL_SEND_LIMIT || 10),
  dailyLimit: Number(process.env.STANDARD_DAILY_SEND_LIMIT || 50),
  interval: Math.max(10, Number(process.env.SEND_INTERVAL_SECONDS || 60)),
  demo: process.env.DEMO_ENABLED !== 'false'
};
if (config.production && (!/^[a-f0-9]{64}$/i.test(config.encryptionKey) || !/^[a-f0-9]{64}$/i.test(process.env.SESSION_SECRET || '') || !config.origin.startsWith('https://'))) throw new Error('Production requires HTTPS APP_URL and separate 32-byte ENCRYPTION_KEY and SESSION_SECRET.');
