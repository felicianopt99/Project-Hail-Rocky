import { createTag } from "../lib/logger";

const log = createTag("RAGService");

export class RAGService {
  async getSystemContext(query?: string) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    log.debug("System context requested", { query });
    return `Time: ${timeStr}`;
  }
}

export const ragService = new RAGService();
