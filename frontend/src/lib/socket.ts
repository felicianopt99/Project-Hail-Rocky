import { io, Socket } from "socket.io-client";
import { ServerToClientEvents, ClientToServerEvents } from "../types/socketEvents";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  reconnectionAttempts: Infinity,
  transports: ["websocket", "polling"],
  timeout: 5000,
});

export default socket;
