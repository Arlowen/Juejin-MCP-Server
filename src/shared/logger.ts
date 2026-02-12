import pino, { type Logger, type LoggerOptions } from "pino";

const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "authorization",
      "*.authorization",
      "password",
      "*.password",
      "token",
      "*.token",
      "apiKey",
      "*.apiKey"
    ],
    censor: "[REDACTED]"
  }
};

export type AppLogger = Logger;

export const appLogger: AppLogger = pino(loggerOptions);
