import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { createTag } from '../lib/logger';

const log = createTag("HA-WS");

interface AreaRegistryEntry {
  area_id: string;
  name: string;
}

interface EntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  [key: string]: any;
}

export class HomeAssistantWS extends EventEmitter {
  private url: string;
  private token: string;
  private ws: WebSocket | null = null;
  private messageId = 1;
  private isConnected = false;
  private pingInterval: NodeJS.Timeout | null = null;

  // Area registry data
  private areaMap: Map<string, string> = new Map();        // area_id → area_name
  private entityAreaMap: Map<string, string> = new Map();  // entity_id → area_id

  // Track pending registry request IDs
  private pendingAreaRegistryId: number | null = null;
  private pendingEntityRegistryId: number | null = null;
  private areaRegistryLoaded = false;
  private entityRegistryLoaded = false;

  constructor() {
    super();
    const baseUrl = process.env.HA_BASE_URL || "";
    // Convert http(s) to ws(s)
    this.url = baseUrl.replace(/^http/, 'ws') + "/api/websocket";
    this.token = process.env.HA_ACCESS_TOKEN || "";
  }

  connect() {
    if (!this.url || !this.token) {
      log.warn("Missing configuration. WebSocket disabled.");
      return;
    }

    log.info("Connecting to Home Assistant WebSocket...", { url: this.url });
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      log.debug("Socket open. Waiting for auth request...");
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (e) {
        log.warn("Failed to parse message", { error: (e as any).message });
      }
    });

    this.ws.on('close', () => {
      log.warn("Connection closed. Reconnecting in 5s...");
      this.isConnected = false;
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      // Reset registry state on reconnect
      this.areaRegistryLoaded = false;
      this.entityRegistryLoaded = false;
      this.pendingAreaRegistryId = null;
      this.pendingEntityRegistryId = null;
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (err) => {
      log.error("Socket error", { error: err.message });
    });
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case "auth_required":
        this.send({
          type: "auth",
          access_token: this.token
        });
        break;

      case "auth_ok":
        log.info("Authenticated successfully!");
        this.isConnected = true;
        this.subscribeToEvents();
        this.fetchRegistries();
        this.emit('ready');
        this.startHeartbeat();
        break;

      case "auth_invalid":
        log.error("Authentication failed", { message: msg.message });
        this.ws?.close();
        break;

      case "event":
        if (msg.event?.event_type === "state_changed") {
          const entityId = msg.event.data.entity_id;
          const supportedDomains = ["light.", "switch.", "fan.", "input_boolean.", "media_player."];
          
          if (supportedDomains.some(domain => entityId.startsWith(domain))) {
            this.emit('state_changed', msg.event.data.new_state);
          }
        }
        break;

      case "result":
        this.handleResult(msg);
        break;
    }
  }

  private handleResult(msg: { id: number; success: boolean; result: any }) {
    if (!msg.success) {
      log.warn(`Request failed`, { id: msg.id });
      return;
    }

    if (msg.id === this.pendingAreaRegistryId) {
      const entries: AreaRegistryEntry[] = msg.result || [];
      this.areaMap.clear();
      for (const area of entries) {
        this.areaMap.set(area.area_id, area.name);
      }
      log.info(`Area registry loaded`, { count: this.areaMap.size });
      this.areaRegistryLoaded = true;
      this.pendingAreaRegistryId = null;
      this.checkAreasLoaded();
    } else if (msg.id === this.pendingEntityRegistryId) {
      const entries: EntityRegistryEntry[] = msg.result || [];
      this.entityAreaMap.clear();
      for (const entity of entries) {
        if (entity.area_id) {
          this.entityAreaMap.set(entity.entity_id, entity.area_id);
        }
      }
      log.info(`Entity registry loaded`, { count: this.entityAreaMap.size });
      this.entityRegistryLoaded = true;
      this.pendingEntityRegistryId = null;
      this.checkAreasLoaded();
    }
  }

  private checkAreasLoaded() {
    if (this.areaRegistryLoaded && this.entityRegistryLoaded) {
      log.info("Both registries loaded. Syncing areas.");
      this.emit("areas_loaded", {
        areaMap: this.areaMap,
        entityAreaMap: this.entityAreaMap,
      });
    }
  }

  private fetchRegistries() {
    const areaId = this.messageId++;
    const entityId = this.messageId++;

    this.pendingAreaRegistryId = areaId;
    this.pendingEntityRegistryId = entityId;

    this.send({ id: areaId, type: "config/area_registry/list" });
    this.send({ id: entityId, type: "config/entity_registry/list" });

    console.log("[HA-WS] Requested area and entity registries.");
  }

  private subscribeToEvents() {
    this.send({
      id: this.messageId++,
      type: "subscribe_events",
      event_type: "state_changed"
    });
    console.log("[HA-WS] Subscribed to state_changed events.");
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // Optional: Add method to call services via WS
  callService(domain: string, service: string, serviceData: any) {
    this.send({
      id: this.messageId++,
      type: "call_service",
      domain,
      service,
      service_data: serviceData
    });
  }

  getAreaForEntity(entityId: string): { areaId: string | null; areaName: string | null } {
    const areaId = this.entityAreaMap.get(entityId) || null;
    const areaName = areaId ? (this.areaMap.get(areaId) || null) : null;
    return { areaId, areaName };
  }

  private startHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({
          id: this.messageId++,
          type: "ping"
        });
      }
    }, 30000); // 30 seconds
  }
}

export const haWS = new HomeAssistantWS();
