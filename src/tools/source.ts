import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Flavor } from "../types.js";
import { flavorMeta } from "../data/manifest.js";
import { SourceRepoCache } from "../source/repo-cache.js";
import { flavorArg, guard, READ_ONLY_NETWORK, text } from "./common.js";

function dataCommit(flavor: Flavor): string {
  const commit = flavorMeta(flavor).commit;
  if (!commit) throw new Error(`No upstream commit recorded for ${flavor}; re-run \`npm run ingest\`.`);
  return commit;
}

export function registerSourceTools(server: McpServer, cache: SourceRepoCache = new SourceRepoCache()): void {
  server.registerTool(
    "search_source",
    {
      title: "Search Blizzard UI source",
      annotations: READ_ONLY_NETWORK,
      description:
        "Regex search (POSIX ERE, via git grep) over Blizzard's FrameXML/AddOn UI source code for a flavor — " +
        "the best way to learn how Blizzard implements UI patterns (templates, mixins, secure code). " +
        "The first search per flavor downloads a ~200 MB source checkout and may take a minute.",
      inputSchema: {
        pattern: z.string().min(1).describe('Regex, e.g. "SecureActionButtonTemplate" or "function UIParent_[A-Za-z]+"'),
        flavor: flavorArg(),
        pathGlob: z
          .string()
          .optional()
          .describe('Limit to paths matching a glob, e.g. "Interface/AddOns/Blizzard_ActionBar/**/*.lua"'),
        ignoreCase: z.boolean().default(false),
        fixedString: z
          .boolean()
          .default(false)
          .describe("Treat the pattern as a literal string rather than a regex"),
        maxResults: z.number().int().min(1).max(500).default(50),
      },
    },
    guard(async ({ pattern, flavor, pathGlob, ignoreCase, fixedString, maxResults }) => {
      const hits = await cache.search(flavor, pattern, dataCommit(flavor), {
        pathGlob,
        ignoreCase,
        fixedString,
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
    }),
  );

  server.registerTool(
    "list_source_files",
    {
      title: "List Blizzard UI source files",
      annotations: READ_ONLY_NETWORK,
      description:
        "List source files matching a path glob, e.g. `**/Blizzard_ActionBar*/**` or `**/*Mixin*.lua`. " +
        "Useful for locating the right addon folder before reading files.",
      inputSchema: {
        glob: z.string().min(1).describe('Path glob, e.g. "Interface/AddOns/Blizzard_UnitFrame/**"'),
        flavor: flavorArg(),
        limit: z.number().int().min(1).max(1000).default(200),
      },
    },
    guard(async ({ glob, flavor, limit }) => {
      const files = await cache.listFiles(flavor, glob, dataCommit(flavor), limit);
      if (files.length === 0) return text(`No files matching \`${glob}\` in ${flavor} source.`);
      return text(`${files.length} file(s) matching \`${glob}\` in ${flavor}:\n${files.map((f) => `- ${f}`).join("\n")}`);
    }),
  );

  server.registerTool(
    "get_source_file",
    {
      title: "Read Blizzard UI source file",
      annotations: READ_ONLY_NETWORK,
      description:
        "Read a file (or list a directory) from Blizzard's UI source for a flavor, with line numbers. " +
        'Paths are repo-relative, e.g. "Interface/AddOns/Blizzard_UIParent/Blizzard_UIParent.lua".',
      inputSchema: {
        path: z.string().min(1).describe("Repo-relative file or directory path"),
        flavor: flavorArg(),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      },
    },
    guard(async ({ path: filePath, flavor, startLine, endLine }) => {
      const result = await cache.readFile(flavor, filePath, dataCommit(flavor));
      if (result.kind === "directory") {
        return text(`Directory ${filePath} in ${flavor} source:\n${result.entries.map((e) => `- ${e}`).join("\n")}`);
      }
      const total = result.lines.length;
      const from = Math.min(startLine ?? 1, total || 1);
      const defaultWindow = 400;
      const to = Math.min(endLine ?? from + defaultWindow - 1, total);
      const numbered = result.lines
        .slice(from - 1, to)
        .map((line, i) => `${String(from + i).padStart(5)}\t${line}`)
        .join("\n");
      const note =
        to < total ? `\n\n(showing lines ${from}-${to} of ${total} — pass startLine/endLine for more)` : "";
      return text(`${filePath} (${flavor}):\n${numbered}${note}`);
    }),
  );
}
