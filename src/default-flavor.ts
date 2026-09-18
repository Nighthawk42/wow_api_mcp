/**
 * Works out which flavor tool calls should assume when the caller does not say.
 *
 * Resolution order:
 *   1. `WOW_API_MCP_FLAVOR` — an explicit flavor ID pins it; `auto` forces a scan.
 *   2. `WOW_INSTALL_PATH` — resolve the release client in that installation.
 *   3. `live` (or the first available flavor).
 *
 * Step 2 only runs when the variable is set, so a normal startup touches no
 * filesystem beyond `data/`; `auto` opts into probing the usual install
 * locations, which is the slower path.
 */
import { flavorSpec, sortFlavors } from "./flavors.js";
import { availableFlavors, fallbackFlavor } from "./data/manifest.js";
import { detectInstalls } from "./install/detect.js";

let cached: string | undefined;

/**
 * Best flavor from an installation.
 *
 * A machine with retail, Classic and Classic Era installed has no objectively
 * correct default, so pick deterministically rather than by match score: live
 * clients beat test realms, and among those the curated flavor order decides
 * (live, then classic, then classic_era, ...). Someone who only has Classic Era
 * installed still gets classic_era, because it is the only candidate.
 */
function fromInstalls(startPath?: string): string | undefined {
  const found = new Set<string>();
  for (const install of detectInstalls(startPath)) {
    for (const client of install.clients) {
      const resolved = client.resolution.best;
      if (!client.clientPresent || !resolved) continue;
      if (client.resolution.confidence === "low" || client.resolution.confidence === "none") continue;
      found.add(resolved.flavor);
    }
  }
  if (found.size === 0) return undefined;
  const ranked = sortFlavors([...found]);
  return ranked.find((f) => flavorSpec(f).channel === "release") ?? ranked[0];
}

export function defaultFlavor(): string {
  if (cached) return cached;
  const flavors = availableFlavors();
  const pinned = process.env.WOW_API_MCP_FLAVOR?.trim();

  if (pinned && pinned !== "auto") {
    if (flavors.includes(pinned)) return (cached = pinned);
    console.error(`wow-api-mcp: WOW_API_MCP_FLAVOR="${pinned}" is not an available flavor; ignoring.`);
  }

  const installPath = process.env.WOW_INSTALL_PATH?.trim();
  if (pinned === "auto" || installPath) {
    try {
      // With an explicit path, resolve inside it; with `auto`, probe the usual spots.
      const detected = fromInstalls(pinned === "auto" ? undefined : installPath);
      if (detected && flavors.includes(detected)) {
        console.error(`wow-api-mcp: defaulting to flavor "${detected}" from the detected game install.`);
        return (cached = detected);
      }
    } catch (error) {
      console.error(`wow-api-mcp: install detection failed (${error instanceof Error ? error.message : error}).`);
    }
  }

  return (cached = fallbackFlavor());
}

/** Test seam. */
export function resetDefaultFlavor(): void {
  cached = undefined;
}
