import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { setupSocketHandlers } from "./handlers";

export function initSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  setupSocketHandlers(io);

  return io;
}
