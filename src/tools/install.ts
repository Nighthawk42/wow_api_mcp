import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flavorSpec } from "../flavors.js";
import { availableFlavors, flavorMeta } from "../data/manifest.js";
import { detectInstalls, findInstallRoot, type DetectedClient } from "../install/detect.js";
import { resolveFlavor } from "../install/resolve.js";
import { readAddonTocs, parseToc } from "../install/toc.js";
import { interfaceVersionFromBuild } from "../types.js";
import { guard, READ_ONLY, text } from "./common.js";

function clientLine(client: DetectedClient): string {
  if (!client.clientPresent) {
    return `- \`${client.directory}\` — no client installed (leftover addon/WTF data only)`;
  }
  const best = client.resolution.best;
  const version = client.version ? `build ${client.version}` : "build unknown";
  const iface = client.interfaceVersion ? `, interface ${client.interfaceVersion}` : "";
  const from = client.versionSource === "unknown" ? "" : ` (from ${client.versionSource})`;
  const target = best
    ? `**${best.flavor}** (${client.resolution.confidence} confidence — ${best.reasons.join("; ")})`
    : "no matching track";
  return (
    `- \`${client.directory}\` — product \`${client.product ?? "?"}\`, ${version}${iface}${from}` +
    `${client.executable ? `, ${client.executable}` : ""}\n  → use flavor ${target}`
  );
}

export function registerInstallTools(server: McpServer): void {
  server.registerTool(
    "detect_wow_install",
    {
      title: "Detect installed WoW clients",
      annotations: READ_ONLY,
      description:
        "Find World of Warcraft installations on this machine and report, for each installed client " +
        "(_retail_, _ptr_, _classic_, _classic_era_, ...), its Blizzard product code, exact game build, " +
        "TOC interface number, and which API flavor to use for it. " +
        "Call this first when working in an addon project so later API lookups target the right client. " +
        "Build numbers come from `.build.info`, falling back to the client executable's version resource.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            "Any path inside a WoW installation (install root, a `_retail_` folder, or an addon directory). " +
              "Omit to probe the usual install locations and $WOW_INSTALL_PATH.",
          ),
      },
    },
    guard(async ({ path: startPath }) => {
      const installs = detectInstalls(startPath);
      if (installs.length === 0) {
        const where = startPath ? `at or above \`${startPath}\`` : "in the usual locations";
        return text(
          `No World of Warcraft installation found ${where}.\n\n` +
            "Pass `path` pointing at your install (the folder containing `_retail_`), or set " +
            "`WOW_INSTALL_PATH` in the MCP server environment.",
        );
      }
      const sections = installs.map((install) => {
        const lines = install.clients.map(clientLine);
        return `## ${install.root}\n${lines.join("\n")}`;
      });
      const resolved = installs
        .flatMap((i) => i.clients)
        .filter((c) => c.clientPresent && c.resolution.best)
        .map((c) => c.resolution.best!.flavor);
      const footer = resolved.length
        ? `\n\nFlavors in use here: ${[...new Set(resolved)].join(", ")}. ` +
          "Pass one as the `flavor` argument to search_api / get_api / search_source."
        : "";
      return text(sections.join("\n\n") + footer);
    }),
  );

  server.registerTool(
    "resolve_flavor",
    {
      title: "Resolve a build to an API flavor",
      annotations: READ_ONLY,
      description:
        "Work out which API flavor matches a game build, a TOC interface number, a Blizzard product code, " +
        "or a path inside a WoW install / addon folder. Use this when you know what the addon targets " +
        '("## Interface: 110107", a `.toc` file, a build string) but not which flavor ID to query.',
      inputSchema: {
        version: z.string().optional().describe('Game build, e.g. "12.1.0.69814" or "1.15.9"'),
        interfaceVersion: z
          .union([z.number().int(), z.string()])
          .optional()
          .describe('TOC interface number, e.g. 120100 or "110107"'),
        product: z.string().optional().describe('Blizzard product code, e.g. "wow", "wow_classic_era", "wowt"'),
        path: z
          .string()
          .optional()
          .describe("Path to a `.toc` file, an addon directory, or anywhere inside a WoW install"),
      },
    },
    guard(async ({ version, interfaceVersion, product, path: inputPath }) => {
      const notes: string[] = [];
      let iface = typeof interfaceVersion === "string" ? Number.parseInt(interfaceVersion, 10) : interfaceVersion;
      let build = version;
      let productCode = product;
      let installDir: string | undefined;

      if (inputPath) {
        const toc = inputPath.toLowerCase().endsWith(".toc") ? parseToc(inputPath) : undefined;
        const tocs = toc ? [toc] : readAddonTocs(inputPath);
        if (tocs.length > 0) {
          const found = tocs.flatMap((t) => t.interfaceVersions);
          if (found.length > 0) {
            notes.push(
              `Read ${tocs.length} .toc file(s) at \`${inputPath}\`: interface ${[...new Set(found)].join(", ")}.`,
            );
            iface ??= found[0];
          }
          // A multi-toc addon targets several flavors; report each one.
          if (found.length > 1 && !build && !productCode) {
            const lines = [...new Set(found)].map((v) => {
              const result = resolveFlavor({ interfaceVersion: v });
              return `- interface ${v} → ${result.best?.flavor ?? "no match"} (${result.confidence})`;
            });
            return text(`${notes.join("\n")}\n\n${lines.join("\n")}`);
          }
        }
        const root = findInstallRoot(inputPath);
        if (root && !build) {
          const install = detectInstalls(inputPath)[0];
          // Prefer the client directory the path actually lives in.
          const normalized = inputPath.replace(/\\/g, "/").toLowerCase();
          const client =
            install?.clients.find((c) => normalized.includes(`/${c.directory.toLowerCase()}/`)) ??
            install?.clients.find((c) => c.clientPresent);
          if (client) {
            notes.push(`Resolved \`${inputPath}\` to \`${client.directory}\` in \`${root}\`.`);
            build ??= client.version;
            productCode ??= client.product;
            installDir = client.directory;
            iface ??= client.interfaceVersion;
          }
        }
      }

      if (!build && !iface && !productCode) {
        return text(
          "Nothing to resolve: pass at least one of `version`, `interfaceVersion`, `product`, or `path`.",
        );
      }
      if (build && !iface) iface = interfaceVersionFromBuild(build);

      const result = resolveFlavor({ version: build, interfaceVersion: iface, product: productCode, installDir });
      if (!result.best) {
        return text(
          `${notes.join("\n")}\n\nNo track matches build ${build ?? "?"} / interface ${iface ?? "?"}.\n` +
            `Available flavors: ${availableFlavors().join(", ")}.`,
        );
      }

      const rows = result.candidates
        .slice(0, 5)
        .map(
          (c) =>
            `| ${c.flavor} | ${flavorSpec(c.flavor).label} | ${c.version} | ${c.interfaceVersion} | ${c.score} | ${c.reasons.join("; ")} |`,
        );
      return text(
        [
          ...notes,
          notes.length > 0 ? "" : undefined,
          `**Use flavor \`${result.best.flavor}\`** (${result.confidence} confidence).`,
          "",
          "| Flavor | Track | Data build | Interface | Score | Why |",
          "| --- | --- | --- | --- | --- | --- |",
          ...rows,
        ]
          .filter((l) => l !== undefined)
          .join("\n"),
      );
    }),
  );

  server.registerTool(
    "check_addon_compatibility",
    {
      title: "Check an addon's API usage against a flavor",
      annotations: READ_ONLY,
      description:
        "Read an addon's `.toc` files, resolve the flavor(s) it targets, and report the game build and " +
        "API data the server will use for each. Point it at an addon directory or a `.toc` file.",
      inputSchema: {
        path: z.string().min(1).describe("Addon directory or `.toc` file path"),
      },
    },
    guard(async ({ path: addonPath }) => {
      const toc = addonPath.toLowerCase().endsWith(".toc") ? parseToc(addonPath) : undefined;
      const tocs = toc ? [toc] : readAddonTocs(addonPath);
      if (tocs.length === 0) {
        return text(`No .toc file with an \`## Interface\` directive found at \`${addonPath}\`.`);
      }
      const lines: string[] = [];
      for (const entry of tocs) {
        const targets = entry.interfaceVersions.map((v) => {
          const result = resolveFlavor({ interfaceVersion: v });
          if (!result.best) return `interface ${v} → no matching track`;
          const meta = flavorMeta(result.best.flavor);
          return `interface ${v} → \`${result.best.flavor}\` (${flavorSpec(result.best.flavor).label}, data build ${meta.version})`;
        });
        lines.push(
          `- **${entry.addon}${entry.suffix ? `_${entry.suffix}` : ""}.toc**` +
            `${entry.title ? ` — ${entry.title}` : ""}\n  ${targets.join("\n  ")}`,
        );
      }
      return text(`${tocs.length} .toc file(s) at \`${addonPath}\`:\n${lines.join("\n")}`);
    }),
  );
}
