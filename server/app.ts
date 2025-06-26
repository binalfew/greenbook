import { createRequestHandler } from "@react-router/express";
import express from "express";
import "react-router";
import {
  cleanupScheduler,
  initializeScheduler,
} from "../app/lib/scheduler.server";

declare module "react-router" {
  interface AppLoadContext {
    VALUE_FROM_EXPRESS: string;
  }
}

export const app = express();

// Initialize scheduler on startup
initializeScheduler().catch(console.error);

// Cleanup scheduler on shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Shutting down scheduler...");
  await cleanupScheduler();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🛑 Shutting down scheduler...");
  await cleanupScheduler();
  process.exit(0);
});

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    getLoadContext() {
      return {
        VALUE_FROM_EXPRESS: "Hello from Express",
      };
    },
  })
);
