import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApiTools } from "./tools/api.js";
import { registerWikiTools } from "./tools/wiki.js";
import { registerSourceTools } from "./tools/source.js";
import { registerInstallTools } from "./tools/install.js";
import { availableFlavors } from "./data/manifest.js";
import { defaultFlavor } from "./default-flavor.js";
import { SERVER_VERSION } from "./version.js";
import type { WikiClient } from "./wiki/client.js";
import type { SourceRepoCache } from "./source/repo-cache.js";

export { SERVER_VERSION };

export interface CreateServerOptions {
  wikiClient?: WikiClient;
  sourceCache?: SourceRepoCache;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "wow-api-mcp", version: SERVER_VERSION },
    {
      instructions:
        "World of Warcraft addon API reference across every wow-ui-source track: " +
        `${availableFlavors().join(", ")} (default ${defaultFlavor()}).\n` +
        "When helping with an addon, call detect_wow_install or resolve_flavor first so API lookups " +
        "target the client the addon actually runs on — signatures differ between retail, Classic, and the " +
        "test realms. Use search_api/get_api for Blizzard's generated docs, search_source for how Blizzard " +
        "implements something, and search_wiki for community documentation.",
    },
  );
  registerApiTools(server);
  registerInstallTools(server);
  registerWikiTools(server, options.wikiClient);
  registerSourceTools(server, options.sourceCache);
  return server;
}
