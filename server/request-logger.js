import { getCorrelationId } from "./correlation.js";
import { logger } from "./logger.js";

/**
 * Express middleware that logs incoming requests and their completion.
 * Captures method, URL, status code, and duration; pulls the correlation
 * ID from AsyncLocalStorage so every log line is pivot-able.
 *
 * Skips noisy paths (Vite/HMR assets, SSE long-polls, favicons) so
 * the log stays focused on user-driven requests.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function requestLogger(req, res, next) {
  const url = req.url;
  if (
    url.startsWith("/assets/") ||
    url.startsWith("/@") ||
    url.startsWith("/app/") ||
    url.startsWith("/node_modules/") ||
    url.startsWith("/__manifest") ||
    url === "/favicon.ico" ||
    url === "/manifest.json" ||
    url.startsWith("/icons/") ||
    url.startsWith("/sw.js") ||
    url.includes("/api/events")
  ) {
    return next();
  }

  const start = Date.now();
  const correlationId = getCorrelationId();

  logger.info({
    msg: "incoming request",
    correlationId,
    method: req.method,
    url: req.originalUrl || req.url,
  });

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger[logLevel]({
      msg: "request completed",
      correlationId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
}
