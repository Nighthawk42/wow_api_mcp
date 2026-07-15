import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FLAVORS, type Flavor } from "../types.js";
import { loadFlavor } from "../data/loader.js";
import { SourceRepoCache } from "../source/repo-cache.js";

const flavorSchema = z
  .enum(FLAVORS)
  .default("live")
  .describe("Game flavor: live (retail), classic, classic_era (vanilla), classic_anniversary");

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function dataCommit(flavor: Flavor): string {
  return loadFlavor(flavor).data.meta.commit;
}

export function registerSourceTools(server: McpServer, cache: SourceRepoCache = new SourceRepoCache()): void {
  server.registerTool(
    "search_source",
    {
      title: "Search Blizzard UI source",
      description:
        "Regex search (POSIX ERE, via git grep) over Blizzard's FrameXML/AddOn UI source code for a flavor — " +
        "the best way to learn how Blizzard implements UI patterns (templates, mixins, secure code). " +
        "The first search per flavor downloads a ~200 MB source checkout and may take a minute.",
      inputSchema: {
        pattern: z.string().min(1).describe('Regex, e.g. "SecureActionButtonTemplate" or "function UIParent_[A-Za-z]+"'),
        flavor: flavorSchema,
        pathGlob: z
          .string()
          .optional()
          .describe('Limit to paths matching a glob, e.g. "Interface/AddOns/Blizzard_ActionBar/**/*.lua"'),
        ignoreCase: z.boolean().default(false),
        maxResults: z.number().int().min(1).max(500).default(50),
      },
    },
    async ({ pattern, flavor, pathGlob, ignoreCase, maxResults }) => {
      const hits = cache.search(flavor as Flavor, pattern, dataCommit(flavor as Flavor), {
        pathGlob,
        ignoreCase,
        maxResults,
      });
      if (hits.length === 0) return text(`No matches for /${pattern}/ in ${flavor} source.`);
      const truncated = hits.length > maxResults;
      const shown = hits.slice(0, maxResults);
      const lines = shown.map((h) => `${h.file}:${h.line}: ${h.text.trim()}`);
      const footer = truncated ? `\n\n(truncated at ${maxResults} — narrow the pattern or pathGlob)` : "";
      return text(
        `${shown.length} match(es) for /${pattern}/ in ${flavor} source (read files with get_source_file):\n` +
          lines.join("\n") +
          footer,
      );
    },
  );

  server.registerTool(
    "get_source_file",
    {
      title: "Read Blizzard UI source file",
      description:
        "Read a file (or list a directory) from Blizzard's UI source for a flavor, with line numbers. " +
        'Paths are repo-relative, e.g. "Interface/AddOns/Blizzard_UIParent/Blizzard_UIParent.lua".',
      inputSchema: {
        path: z.string().min(1).describe("Repo-relative file or directory path"),
        flavor: flavorSchema,
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      },
    },
    async ({ path: filePath, flavor, startLine, endLine }) => {
      const result = cache.readFile(flavor as Flavor, filePath, dataCommit(flavor as Flavor));
      if (result.kind === "directory") {
        return text(`Directory ${filePath} in ${flavor} source:\n${result.entries.map((e) => `- ${e}`).join("\n")}`);
      }
      const total = result.lines.length;
      const from = startLine ?? 1;
      const defaultWindow = 400;
      const to = Math.min(endLine ?? from + defaultWindow - 1, total);
      const numbered = result.lines
        .slice(from - 1, to)
        .map((line, i) => `${String(from + i).padStart(5)}\t${line}`)
        .join("\n");
      const note =
        to < total
          ? `\n\n(showing lines ${from}-${to} of ${total} — pass startLine/endLine for more)`
          : "";
      return text(`${filePath} (${flavor}):\n${numbered}${note}`);
    },
  );
}
