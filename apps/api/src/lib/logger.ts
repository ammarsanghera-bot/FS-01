import pino from "pino";
import { env } from "../config.js";

export const logger = pino({
  level: env.logLevel,
  redact: ["req.headers.authorization", "req.headers.cookie"],
});
