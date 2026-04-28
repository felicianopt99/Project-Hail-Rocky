import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env and .env.local (standard practice for local development)
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
import express from "express";
import { createServer } from "http";
import { createServer as createViteServer } from "vite";
import { initSocketServer } from "./src/socket";
import { systemStateManager } from "./src/managers/SystemStateManager";
import { sessionManager } from "./src/managers/SessionManager";
import { kokoroService } from "./src/services/kokoroService";
import { healthMonitor } from "./src/services/serviceHealthMonitor";
import "./src/services/audio/AudioProcessor"; // side-effect: registers audio pipeline listeners
import { logger } from "./src/lib/logger";
import { checkHAHealth } from "./src/services/homeAssistantService";

const log = logger.child({ tag: "Server" });

const PORT = parseInt(process.env.PORT || "3005", 10);

async function startServer() {
  log.info("ROCKY SERVER STARTING - V3 (Noise Awareness)");
  const app = express();
  const httpServer = createServer(app);

  // 0. Home Assistant Health Check
  const haHealth = await checkHAHealth();
  if (!haHealth.success) {
    console.error("\n" + "=".repeat(60));
    console.error("🚨 CRITICAL: HOME ASSISTANT CONNECTION FAILED 🚨");
    console.error("Reason:", haHealth.error);
    console.error("Rocky will start but HA skills will fail.");
    console.error("=".repeat(60) + "\n");
  } else {
    log.info("Home Assistant Link: OK");
  }

  // 1. Initialize State Manager
  await systemStateManager.initialize();

  // 2. Initialize Socket.io
  initSocketServer(httpServer);

  // 3. API Routes
  app.get("/api/health", (req, res) => {
    const health = healthMonitor.getStatus();
    const isDegraded = Object.values(health).some(s => s === "degraded" || s === "offline");
    
    res.status(isDegraded ? 503 : 200).json({
      status: isDegraded ? "degraded" : "ok", 
      message: "Rocky is alive, yes!", 
      version: "2.1.0",
      services: health,
      timestamp: new Date().toISOString()
    });
  });

  // 4. Vite/Static Files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 5. Start listening
  const server = httpServer.listen(PORT, "0.0.0.0", () => {
    log.info({ port: PORT, url: `http://localhost:${PORT}` }, `Rocky v2.1 System core operational`);
    // Pre-warm Kokoro TTS to eliminate cold-start latency on first response
    setTimeout(() => kokoroService.warmup().catch(() => {}), 3000);
  });

  // 6. Graceful Shutdown
  const shutdown = async (signal: string) => {
    log.info(`${signal} received. Initiating graceful shutdown...`);

    // Stop intervals and cleanup managers
    systemStateManager.stop();
    sessionManager.stop();
    
    server.close(() => {
      log.info("HTTP server closed.");
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      log.error("Could not close connections in time, forcefully shutting down");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  log.error({ error: err.message, stack: err.stack }, "Failed to start Rocky server");
  process.exit(1);
});
