import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flavorSpec } from "../flavors.js";
import { availableFlavors, flavorMeta, manifest } from "../data/manifest.js";
import {
  availability,
  entryNames,
  loadFlavor,
  lookupByName,
  searchFlavor,
  type EntryKind,
} from "../data/loader.js";
import { functionSignature, oneLiner, renderEntry } from "../format.js";
import { flavorArg, guard, text } from "./common.js";

/** Compact "present in / missing from" line rather than a row per flavor. */
function availabilityLine(name: string): string {
  const flavors = availableFlavors();
  const map = availability(name, flavors);
  const present = flavors.filter((f) => map.get(f));
  const missing = flavors.filter((f) => !map.get(f));
  const parts = [`present in ${present.length}/${flavors.length}: ${present.join(", ") || "none"}`];
  if (missing.length > 0) parts.push(`missing from: ${missing.join(", ")}`);
  return `Availability: ${parts.join(" · ")}`;
}

export function registerApiTools(server: McpServer): void {
  server.registerTool(
    "list_flavors",
    {
      title: "List WoW flavors",
      description:
        "List every client flavor (wow-ui-source track) this server carries, with its game build, " +
        "TOC interface version, upstream commit, and API counts. Use it to pick a `flavor` argument.",
      inputSchema: {
        line: z
          .enum(["all", "retail", "classic", "classic_era", "other"])
          .default("all")
          .describe("Restrict to one game line"),
      },
    },
    guard(async ({ line }) => {
      const rows = manifest()
        .flavors.filter((f) => line === "all" || flavorSpec(f.flavor).line === line)
        .map((f) => {
          const spec = flavorSpec(f.flavor);
          return (
            `| ${f.flavor} | ${spec.label} | ${spec.channel} | ${f.version} | ${f.interfaceVersion} | ` +
            `${f.commit.slice(0, 10)} | ${f.counts.systems} | ${f.counts.functions} | ${f.counts.events} | ${f.counts.tables} |`
          );
        });
      if (rows.length === 0) return text(`No flavors in the "${line}" line.`);
      return text(
        [
          "| Flavor | Track | Channel | Build | Interface | Commit | Systems | Functions | Events | Tables |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          ...rows,
          "",
          "Flavor IDs are the upstream branch names in Gethe/wow-ui-source.",
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "list_systems",
    {
      title: "List API systems",
      description:
        "List API systems (namespaces) for a flavor. Optionally filter by a case-insensitive substring of the system or namespace name.",
      inputSchema: {
        flavor: flavorArg(),
        filter: z.string().optional().describe("Substring filter on system/namespace name"),
      },
    },
    guard(async ({ flavor, filter }) => {
      const { data } = loadFlavor(flavor);
      const needle = filter?.toLowerCase();
      const systems = data.systems.filter(
        (s) =>
          !needle || s.Name.toLowerCase().includes(needle) || (s.Namespace ?? "").toLowerCase().includes(needle),
      );
      if (systems.length === 0) return text(`No systems matching "${filter}" in ${flavor}.`);
      const lines = systems.map(
        (s) =>
          `- ${s.Name}${s.Namespace ? ` (\`${s.Namespace}\`)` : ""} — ` +
          `${s.FunctionCount} functions, ${s.EventCount} events, ${s.TableCount} tables`,
      );
      return text(`${systems.length} system(s) in ${flavor}:\n${lines.join("\n")}`);
    }),
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
        flavor: flavorArg(),
        kind: z.enum(["function", "event", "table", "any"]).default("any").describe("Restrict result kind"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    guard(async ({ query, flavor, kind, limit }) => {
      const hits = searchFlavor(flavor, query, kind as EntryKind | "any", limit);
      if (hits.length === 0) {
        return text(`No ${kind === "any" ? "" : `${kind} `}results for "${query}" in ${flavor}.`);
      }
      const lines = hits.map((h) => `- ${oneLiner(h)}`);
      return text(
        `${hits.length} result(s) for "${query}" in ${flavor} (use get_api for full details):\n${lines.join("\n")}`,
      );
    }),
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
        flavor: flavorArg(),
      },
    },
    guard(async ({ name, flavor }) => {
      const matches = lookupByName(flavor, name);
      if (matches.length === 0) {
        const suggestions = searchFlavor(flavor, name, "any", 5);
        const elsewhere = availableFlavors().filter((f) => f !== flavor && availability(name, [f]).get(f));
        const hints: string[] = [];
        if (elsewhere.length > 0) hints.push(`\n\nPresent in other flavors: ${elsewhere.join(", ")}.`);
        if (suggestions.length > 0) {
          hints.push(`\n\nClosest matches:\n${suggestions.map((s) => `- ${oneLiner(s)}`).join("\n")}`);
        }
        return text(`No API named "${name}" in ${flavor}.${hints.join("")}`);
      }
      const meta = flavorMeta(flavor);
      const body = matches.map((m) => renderEntry(m)).join("\n\n---\n\n");
      return text(
        `${body}\n\nFlavor: ${flavor} (${flavorSpec(flavor).label}, build ${meta.version})\n${availabilityLine(name)}`,
      );
    }),
  );

  server.registerTool(
    "diff_api",
    {
      title: "Compare one API across flavors",
      description:
        "Compare an API's existence and signature across flavors. Useful to check whether an API exists in a " +
        "given client and whether its signature drifted between retail, classic, and the test realms.",
      inputSchema: {
        name: z.string().min(1).describe("API name, qualified or bare"),
        flavors: z
          .array(z.string())
          .optional()
          .describe("Flavors to compare (default: every flavor that has the API, plus the release flavors)"),
      },
    },
    guard(async ({ name, flavors }) => {
      const all = availableFlavors();
      const requested = flavors?.filter((f) => all.includes(f));
      const present = all.filter((f) => availability(name, [f]).get(f));
      if (present.length === 0 && !requested?.length) {
        return text(`No API named "${name}" in any flavor (${all.join(", ")}).`);
      }
      // Comparing every flavor would load a dozen payloads; default to the ones
      // that have it plus the release channels, so absences still show up.
      const compare =
        requested && requested.length > 0
          ? requested
          : all.filter((f) => present.includes(f) || flavorSpec(f).channel === "release");

      const sections: string[] = [];
      const signatures = new Set<string>();
      for (const flavor of compare) {
        const meta = flavorMeta(flavor);
        const header = `## ${flavor} — ${flavorSpec(flavor).label} (${meta.version})`;
        const entries = lookupByName(flavor, name);
        if (entries.length === 0) {
          sections.push(`${header}\nNot present.`);
          continue;
        }
        const lines = entries.map((e) => {
          if (e.kind !== "function") return oneLiner(e);
          const signature = functionSignature(e.entry);
          signatures.add(signature);
          return `\`${signature}\``;
        });
        sections.push(`${header}\n${lines.join("\n")}`);
      }

      const note =
        signatures.size > 1 ? "\n\n⚠ Signatures differ between flavors — check each one above." : "";
      return text(sections.join("\n\n") + note);
    }),
  );

  server.registerTool(
    "diff_flavors",
    {
      title: "Diff two flavors' API surface",
      description:
        "List APIs added or removed between two flavors — e.g. what the retail PTR gained over live, or what " +
        "retail has that Classic Era lacks. Answers 'is this API safe to use on <client>' in bulk.",
      inputSchema: {
        from: flavorArg("Baseline flavor"),
        to: flavorArg("Flavor to compare against the baseline"),
        kind: z.enum(["function", "event", "table", "any"]).default("any"),
        direction: z
          .enum(["added", "removed", "both"])
          .default("both")
          .describe("added = in `to` only; removed = in `from` only"),
        filter: z.string().optional().describe("Case-insensitive substring filter on the API name"),
        limit: z.number().int().min(1).max(500).default(100),
      },
    },
    guard(async ({ from, to, kind, direction, filter, limit }) => {
      if (from === to) return text("`from` and `to` are the same flavor — nothing to diff.");
      const fromNames = entryNames(from, kind as EntryKind | "any");
      const toNames = entryNames(to, kind as EntryKind | "any");
      const needle = filter?.toLowerCase();
      const pick = (source: typeof fromNames, other: typeof toNames) =>
        [...source.keys()]
          .filter((n) => !other.has(n) && (!needle || n.toLowerCase().includes(needle)))
          .sort();

      const added = direction === "removed" ? [] : pick(toNames, fromNames);
      const removed = direction === "added" ? [] : pick(fromNames, toNames);

      const section = (title: string, names: string[], source: typeof fromNames) => {
        if (names.length === 0) return [`**${title}**: none.`];
        const shown = names.slice(0, limit);
        const lines = shown.map((n) => `- ${oneLiner(source.get(n)!)}`);
        if (names.length > shown.length) {
          lines.push(`(+${names.length - shown.length} more — raise \`limit\` or narrow with \`filter\`)`);
        }
        return [`**${title}** (${names.length}):`, ...lines];
      };

      const header =
        `${from} (${flavorMeta(from).version}) → ${to} (${flavorMeta(to).version})` +
        `${filter ? `, filtered by "${filter}"` : ""}${kind === "any" ? "" : `, ${kind}s only`}`;
      const body: string[] = [];
      if (direction !== "removed") body.push(...section(`Only in ${to}`, added, toNames), "");
      if (direction !== "added") body.push(...section(`Only in ${from}`, removed, fromNames));
      return text(`${header}\n\n${body.join("\n")}`);
    }),
  );
}
