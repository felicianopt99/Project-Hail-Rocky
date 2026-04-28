import { io, Socket } from "socket.io-client";

const LOG_TAG = "[SocketIO]";

function log(level: "info" | "warn" | "error", msg: string, data?: any) {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} ${LOG_TAG} [${level.toUpperCase()}]`;
  if (level === "error") {
    console.error(`${prefix} ${msg}`, data || "");
  } else if (level === "warn") {
    console.warn(`${prefix} ${msg}`, data || "");
  } else {
    console.log(`${prefix} ${msg}`, data || "");
  }
}

// Generate or retrieve a stable device ID
let deviceId = localStorage.getItem("rocky_device_id");
if (!deviceId) {
  deviceId = "device_" + Date.now() + "_" + Math.random().toString(36).substring(2, 15);
  localStorage.setItem("rocky_device_id", deviceId);
}

log("info", "Initializing Socket.io connection", { deviceId });

const socket: Socket = io(undefined, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 10,
  auth: {
    deviceId,
  },
  transportOptions: {
    websocket: {
      perMessageDeflate: false, // Disable compression for audio
    },
  },
});

// ========== HEARTBEAT (ping every 30s) ==========
let heartbeatInterval: NodeJS.Timeout | null = null;

socket.on("connect", () => {
  log("info", "Socket connected successfully", {
    socketId: socket.id,
    transport: (socket.io.engine as any).transport?.name || "unknown",
  });

  // Start heartbeat
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    socket.emit("ping", { timestamp: Date.now() }, (ack: any) => {
      const latency = Date.now() - (ack?.timestamp || 0);
      log("info", "Heartbeat acknowledged", { latency: `${latency}ms` });
    });
  }, 30000);
});

socket.on("disconnect", (reason) => {
  log("warn", "Socket disconnected", { reason });

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (reason === "io server disconnect") {
    log("warn", "Server initiated disconnect, will attempt to reconnect");
    socket.connect();
  }
});

socket.on("connect_error", (error: any) => {
  log("error", "Connection error", {
    message: error.message,
    type: error.type,
  });
});

socket.on("error", (error: any) => {
  log("error", "Socket error", error);
});

// ========== AUDIO CHUNK ACK ==========
socket.on("audio_chunk_ack", (data: any) => {
  log("info", "Audio chunk acknowledged", {
    chunkNumber: data.chunkNumber,
  });
});

export default socket;
export { deviceId };
