/**
 * OpenClaw JSON-RPC v3 Protocol Types
 * Reference: https://docs.openclaw.ai/gateway/protocol
 */

export interface RPCFrame {
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: RPCError;
  event?: string;
}

export interface RPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ConnectChallenge {
  challenge: string;
}

export interface ConnectRequest {
  id: string;
  challenge: string;
  challenge_response: string;
  client: {
    id: string;
    mode: string;
    platform: string;
  };
  role: string;
  scopes: string[];
  minProtocol: number;
  maxProtocol: number;
}

export interface ConnectResponse {
  id: string;
  ok: boolean;
  result?: {
    id: string;
    version: string;
  };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

export interface ChatSendRequest {
  method: "chat.send";
  params: {
    message: string;
    context?: string;
  };
}

export interface ChatResponse {
  id: string;
  method: string;
  result?: unknown;
  error?: RPCError;
}

export interface ChatTokenEvent {
  event: "chat.token";
  data: {
    token: string;
    timestamp: number;
  };
}

export interface ChatCompleteEvent {
  event: "chat.response";
  data: {
    content: string;
    timestamp: number;
    model?: string;
  };
}

export interface StatusUpdateEvent {
  event: "status.update";
  data: {
    status: "listening" | "thinking" | "speaking" | "idle" | "error";
    timestamp: number;
    details?: string;
  };
}

export type OpenClawEvent =
  | ConnectChallenge
  | ChatTokenEvent
  | ChatCompleteEvent
  | StatusUpdateEvent;

export interface SocketState {
  isConnected: boolean;
  isAuthenticated: boolean;
  lastActivity: number;
  reconnectAttempts: number;
}
