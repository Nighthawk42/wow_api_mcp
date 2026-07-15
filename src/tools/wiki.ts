import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { attribution, WikiClient } from "../wiki/client.js";

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

export function registerWikiTools(server: McpServer, client: WikiClient = new WikiClient()): void {
  server.registerTool(
    "search_wiki",
    {
      title: "Search Warcraft Wiki",
      description:
        "Search warcraft.wiki.gg — community documentation for the WoW addon API, UI widgets, events, " +
        "TOC format, CVars, and guides. Returns page titles to use with get_wiki_page.",
      inputSchema: {
        query: z.string().min(1).describe('Search terms, e.g. "TOC format" or "SecureActionButtonTemplate"'),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ query, limit }) => {
      const results = await client.search(query, limit);
      if (results.length === 0) return text(`No wiki results for "${query}".`);
      const lines = results.map((r) => `- **${r.title}** — ${r.snippet} (${r.url})`);
      return text(`${results.length} wiki result(s) for "${query}":\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "get_wiki_page",
    {
      title: "Get Warcraft Wiki page",
      description:
        "Fetch a warcraft.wiki.gg page as markdown (cached ~24h). Useful pages: \"TOC format\", " +
        '"World of Warcraft API", "Events", "Widget API", "API <FunctionName>" for per-function pages, ' +
        '"UIHANDLER <OnEvent>" for script handlers.',
      inputSchema: {
        title: z.string().min(1).describe('Page title, e.g. "TOC format" or "API C_Timer.After"'),
        maxChars: z.number().int().min(1000).max(200_000).default(40_000).describe("Truncate output beyond this length"),
      },
    },
    async ({ title, maxChars }) => {
      try {
        const page = await client.getPage(title, maxChars);
        return text(`# ${page.title}\n\n${page.markdown}\n\n---\n${attribution(page.url)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const suggestions = await client.search(title, 5).catch(() => []);
        const hint =
          suggestions.length > 0
            ? `\n\nDid you mean:\n${suggestions.map((s) => `- ${s.title}`).join("\n")}`
            : "";
        return text(`${message}${hint}`);
      }
    },
  );
}
