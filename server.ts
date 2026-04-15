import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // State
  const state = {
    lights: {
      studio: { status: "off", color: "#00ffff", brightness: 80 },
      desk: { status: "off", color: "#ff00ff", brightness: 100 },
      kitchen: { status: "off", color: "#ffffff", brightness: 70 },
      bedroom: { status: "off", color: "#ffffff", brightness: 60 },
      living: { status: "off", color: "#ffffff", brightness: 75 },
      ambient: { status: "off", color: "#0000ff", brightness: 50 },
    },
    logs: [
      { timestamp: Date.now(), message: "System initialized. Rocky is ready, yes!" },
      { timestamp: Date.now() - 10000, message: "Calibrating DMX controllers..." },
    ],
    systemMode: "dashboard", // dashboard, visualizer, cinema, music
  };

  // Mock hardware data generator
  setInterval(() => {
    const cpu = Math.floor(Math.random() * 15) + 5; 
    const ram = Math.floor(Math.random() * 200) + 3800; 
    const temp = Math.floor(Math.random() * 3) + 42; 
    
    io.emit("stats", {
      cpu,
      ram,
      temp,
      timestamp: Date.now(),
    });

    // Proactive check: if temp > 44, add a log and emit proactive alert
    if (temp > 44 && !state.logs.some(l => l.message.includes("Temperature high") && Date.now() - l.timestamp < 60000)) {
      const log = { timestamp: Date.now(), message: `Temperature high (${temp}°C). Monitoring, yes?` };
      state.logs.unshift(log);
      io.emit("new_log", log);
      
      // Feature 5: Proactive Rocky Alert
      io.emit("proactive_alert", {
        type: "temperature",
        value: temp,
        message: `Humano, o sistema está a aquecer (${temp}°C). Devo ajustar as luzes para um tom mais frio para ajudar a "arrefecer" visualmente, yes?`
      });
    }

    if (cpu > 18 && !state.logs.some(l => l.message.includes("CPU Load high") && Date.now() - l.timestamp < 60000)) {
      const log = { timestamp: Date.now(), message: `CPU Load high (${cpu}%). Processing intensity is high, yes.` };
      state.logs.unshift(log);
      io.emit("new_log", log);

      io.emit("proactive_alert", {
        type: "cpu",
        value: cpu,
        message: `Muita atividade no processador, humano (${cpu}%). O Rocky está a trabalhar no limite, yes! Quer que eu otimize os protocolos de iluminação?`
      });
    }
  }, 2000);

  // Socket handlers
  io.on("connection", (socket) => {
    console.log("[Rocky] Client connected");
    
    // Send initial state
    socket.emit("initial_state", state);

    socket.on("control_device", (data: { device: string, action: string, params?: any }) => {
      console.log(`[Rocky] Executing tool: ${data.device} -> ${data.action}`, data.params);
      
      if (state.lights[data.device as keyof typeof state.lights]) {
        const light = state.lights[data.device as keyof typeof state.lights];
        if (data.action === "toggle") {
          light.status = light.status === "on" ? "off" : "on";
        } else if (data.action === "set") {
          Object.assign(light, data.params);
        }
        
        const log = { 
          timestamp: Date.now(), 
          message: `Light ${data.device} ${light.status === 'on' ? 'activated' : 'deactivated'}. Good, good, good.` 
        };
        state.logs.unshift(log);
        
        io.emit("device_updated", { device: data.device, state: light });
        io.emit("new_log", log);
      }
    });

    socket.on("add_log", (message: string) => {
      const log = { timestamp: Date.now(), message };
      state.logs.unshift(log);
      io.emit("new_log", log);
    });

    socket.on("set_mode", (mode: string) => {
      console.log(`[Rocky] Mode switch: ${mode}`);
      state.systemMode = mode;
      
      // Automatic light adjustments based on mode
      if (mode === "cinema") {
        state.lights.studio.status = "off";
        state.lights.desk.status = "off";
        state.lights.kitchen.status = "off";
        state.lights.bedroom.status = "off";
        state.lights.living.status = "off";
        state.lights.ambient.status = "on";
        state.lights.ambient.brightness = 20;
        state.lights.ambient.color = "#ffaa00"; // Warm dim
      } else if (mode === "music") {
        state.lights.studio.status = "on";
        state.lights.studio.color = "#00ffff";
        state.lights.desk.status = "on";
        state.lights.desk.color = "#ff00ff";
        state.lights.kitchen.status = "off";
        state.lights.bedroom.status = "off";
        state.lights.living.status = "on";
        state.lights.living.color = "#ff0000";
        state.lights.ambient.status = "on";
        state.lights.ambient.color = "#0000ff";
      } else if (mode === "sunset") {
        state.lights.studio.status = "on";
        state.lights.desk.status = "on";
        state.lights.kitchen.status = "off";
        state.lights.bedroom.status = "on";
        state.lights.living.status = "on";
        state.lights.ambient.status = "on";
        state.lights.ambient.brightness = 40;
      } else if (mode === "dashboard" || mode === "protocols") {
        state.lights.studio.status = "on";
        state.lights.desk.status = "on";
        state.lights.kitchen.status = "on";
        state.lights.bedroom.status = "on";
        state.lights.living.status = "on";
        state.lights.ambient.status = "on";
      }

      io.emit("mode_updated", mode);
      io.emit("initial_state", state); // Sync all clients with new light states
      
      const log = { timestamp: Date.now(), message: `System mode shifted to ${mode.toUpperCase()}. Lights adjusted, yes.` };
      state.logs.unshift(log);
      io.emit("new_log", log);
    });
  });

  // Sunset Mode Oscillation
  let sunsetTick = 0;
  setInterval(() => {
    if (state.systemMode === "sunset") {
      sunsetTick += 0.02;
      
      // Interpolate between Orange-Red and Faded Purple
      // Orange-Red: rgb(255, 69, 0)
      // Faded Purple: rgb(147, 112, 219)
      const r = Math.floor(255 - (255 - 147) * (Math.sin(sunsetTick) + 1) / 2);
      const g = Math.floor(69 + (112 - 69) * (Math.sin(sunsetTick) + 1) / 2);
      const b = Math.floor(0 + (219 - 0) * (Math.sin(sunsetTick) + 1) / 2);
      
      const color = `rgb(${r}, ${g}, ${b})`;
      
      Object.keys(state.lights).forEach(key => {
        const k = key as keyof typeof state.lights;
        if (state.lights[k].status === "on") {
          state.lights[k].color = color;
        }
      });
      
      io.emit("initial_state", state);
    }
  }, 1000);

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Rocky is alive, yes!" });
  });

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

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Rocky] Server running on http://localhost:${PORT}`);
  });
}

startServer();
