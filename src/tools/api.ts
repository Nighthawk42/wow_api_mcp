import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FLAVORS, type Flavor } from "../types.js";
import { availability, loadFlavor, lookupByName, searchFlavor, type EntryKind } from "../data/loader.js";
import { functionSignature, oneLiner, renderEntry } from "../format.js";

const flavorSchema = z
  .enum(FLAVORS)
  .default("live")
  .describe("Game flavor: live (retail), classic, classic_era (vanilla), classic_anniversary");

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function availabilityLine(name: string): string {
  const parts = [...availability(name).entries()].map(([flavor, entries]) => {
    const version = entries.length > 0 ? loadFlavor(flavor).data.meta.version : null;
    return version ? `${flavor} ✓ (${version})` : `${flavor} ✗`;
  });
  return `Availability: ${parts.join(" · ")}`;
}

export function registerApiTools(server: McpServer): void {
  server.registerTool(
    "list_flavors",
    {
      title: "List WoW flavors",
      description:
        "List the available WoW client flavors with their game build, interface version, data source commit, and API counts.",
      inputSchema: {},
    },
    async () => {
      const rows = FLAVORS.map((flavor) => {
        const { meta, functions, events, tables, systems } = loadFlavor(flavor).data;
        return (
          `| ${flavor} | ${meta.version} | ${meta.interfaceVersion} | ${meta.commit.slice(0, 10)} | ` +
          `${systems.length} | ${functions.length} | ${events.length} | ${tables.length} |`
        );
      });
      return text(
        [
          "| Flavor | Build | Interface | Commit | Systems | Functions | Events | Tables |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          ...rows,
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "list_systems",
    {
      title: "List API systems",
      description:
        "List API systems (namespaces) for a flavor. Optionally filter by a case-insensitive substring of the system or namespace name.",
      inputSchema: {
        flavor: flavorSchema,
        filter: z.string().optional().describe("Substring filter on system/namespace name"),
      },
    },
    async ({ flavor, filter }) => {
      const { data } = loadFlavor(flavor as Flavor);
      const needle = filter?.toLowerCase();
      const systems = data.systems.filter(
        (s) =>
          !needle ||
          s.Name.toLowerCase().includes(needle) ||
          (s.Namespace ?? "").toLowerCase().includes(needle),
      );
      if (systems.length === 0) return text(`No systems matching "${filter}" in ${flavor}.`);
      const lines = systems.map(
        (s) =>
          `- ${s.Name}${s.Namespace ? ` (\`${s.Namespace}\`)` : ""} — ` +
          `${s.FunctionCount} functions, ${s.EventCount} events, ${s.TableCount} tables`,
      );
      return text(`${systems.length} system(s) in ${flavor}:\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "search_api",
    {
      title: "Search WoW API",
      description:
        "Fuzzy full-text search over API functions, events, and tables (enums/structures/constants) for a flavor. " +
        'Searches names, systems, and documentation. Example queries: "C_Timer After", "unit health", "spell cooldown".',
      inputSchema: {
        query: z.string().min(1).describe("Search terms (names tokenize on _ . and camelCase)"),
        flavor: flavorSchema,
        kind: z.enum(["function", "event", "table", "any"]).default("any").describe("Restrict result kind"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ query, flavor, kind, limit }) => {
      const hits = searchFlavor(flavor as Flavor, query, kind as EntryKind | "any", limit);
      if (hits.length === 0) {
        return text(`No ${kind === "any" ? "" : `${kind} `}results for "${query}" in ${flavor}.`);
      }
      const lines = hits.map((h) => `- ${oneLiner(h)}`);
      return text(
        `${hits.length} result(s) for "${query}" in ${flavor} (use get_api for full details):\n${lines.join("\n")}`,
      );
    },
  );

  server.registerTool(
    "get_api",
    {
      title: "Get API details",
      description:
        "Full documentation for a function, event, or table by name — signature, typed arguments/returns/payload/fields, " +
        'and cross-flavor availability. Accepts qualified names ("C_Timer.After"), bare names ("After"), ' +
        'or event literals ("PLAYER_ENTERING_WORLD"). Case-insensitive.',
      inputSchema: {
        name: z.string().min(1).describe("API name, qualified or bare"),
        flavor: flavorSchema,
      },
    },
    async ({ name, flavor }) => {
      const matches = lookupByName(flavor as Flavor, name);
      if (matches.length === 0) {
        const suggestions = searchFlavor(flavor as Flavor, name, "any", 5);
        const hint =
          suggestions.length > 0
            ? `\n\nClosest matches:\n${suggestions.map((s) => `- ${oneLiner(s)}`).join("\n")}`
            : "";
        return text(`No API named "${name}" in ${flavor}.${hint}`);
      }
      const meta = loadFlavor(flavor as Flavor).data.meta;
      const body = matches.map((m) => renderEntry(m)).join("\n\n---\n\n");
      return text(`${body}\n\nFlavor: ${flavor} (build ${meta.version})\n${availabilityLine(name)}`);
    },
  );

  server.registerTool(
    "diff_api",
    {
      title: "Compare API across flavors",
      description:
        "Compare an API's existence and signature across all four flavors (live, classic, classic_era, classic_anniversary). " +
        "Useful to check whether an API exists in a given flavor and whether its signature differs.",
      inputSchema: {
        name: z.string().min(1).describe("API name, qualified or bare"),
      },
    },
    async ({ name }) => {
      const perFlavor = availability(name);
      const anyMatch = [...perFlavor.values()].some((entries) => entries.length > 0);
      if (!anyMatch) return text(`No API named "${name}" in any flavor.`);

      const sections: string[] = [];
      for (const [flavor, entries] of perFlavor) {
        const version = loadFlavor(flavor).data.meta.version;
        if (entries.length === 0) {
          sections.push(`## ${flavor} (${version})\nNot present.`);
          continue;
        }
        const lines = entries.map((e) =>
          e.kind === "function" ? `\`${functionSignature(e.entry)}\`` : oneLiner(e),
        );
        sections.push(`## ${flavor} (${version})\n${lines.join("\n")}`);
      }

      // Point out signature drift between flavors that do have the API.
      const signatures = new Set(
        [...perFlavor.values()]
          .flat()
          .filter((e) => e.kind === "function")
          .map((e) => functionSignature(e.entry)),
      );
      const note =
        signatures.size > 1
          ? "\n\n⚠ Signatures differ between flavors — check each one above."
          : "";
      return text(sections.join("\n\n") + note);
    },
  );
}
