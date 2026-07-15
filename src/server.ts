import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApiTools } from "./tools/api.js";

export const SERVER_VERSION = "0.1.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "wow-api-mcp",
    version: SERVER_VERSION,
  });
  registerApiTools(server);
  return server;
}
