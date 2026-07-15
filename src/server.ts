import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApiTools } from "./tools/api.js";
import { registerWikiTools } from "./tools/wiki.js";
import type { WikiClient } from "./wiki/client.js";

export const SERVER_VERSION = "0.1.0";

export interface CreateServerOptions {
  wikiClient?: WikiClient;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "wow-api-mcp",
    version: SERVER_VERSION,
  });
  registerApiTools(server);
  registerWikiTools(server, options.wikiClient);
  return server;
}
