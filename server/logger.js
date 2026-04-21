import pino from "pino";

// Express-side mirror of app/utils/monitoring/logger.server.ts.
// Kept in JS so it's safe to import from server/app.ts before the
// React Router bundler has compiled the app/* modules.

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction
    ? {
        formatters: {
          level(label) {
            return { level: label };
          },
        },
      }
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }),
  base: {
    service: process.env.APP_NAME || "app",
    version: process.env.APP_VERSION || "dev",
    environment: process.env.NODE_ENV || "development",
  },
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "authorization",
      "cookie",
      "sessionId",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});
