import pino from "pino";

const isProduction = process.env['NODE_ENV'] === "production";

export const logger = pino({
  level: process.env['LOG_LEVEL'] || "info",
  transport: !isProduction
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

// Helper for consistent tagging
export const createTag = (tag: string) => {
  return {
    info: (msg: string, data?: any) => logger.info({ tag, ...data }, msg),
    warn: (msg: string, data?: any) => logger.warn({ tag, ...data }, msg),
    error: (msg: string, data?: any) => logger.error({ tag, ...data }, msg),
    debug: (msg: string, data?: any) => logger.debug({ tag, ...data }, msg),
  };
};
