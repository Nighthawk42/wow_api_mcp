/**
 * The manifest and name index are the cheap tier of the data layer: they are
 * small enough to load once at startup, and let `list_flavors`, availability
 * checks and flavor resolution answer without parsing any multi-megabyte
 * flavor payload.
 */
import fs from "node:fs";
import path from "node:path";
import { sortFlavors } from "../flavors.js";
import type { DataManifest, FlavorManifestEntry } from "../types.js";
import { DATA_DIR, MANIFEST_FILE, NAMES_FILE, discoverFlavorFiles, flavorFile, readJson } from "./paths.js";

export const DATA_FORMAT_VERSION = 2;

let manifestCache: DataManifest | undefined;
let namesCache: Map<string, Set<string>> | undefined;

function buildFallbackManifest(): DataManifest {
  // No `_manifest.json` (e.g. a half-finished ingest): derive what we can so
  // the server still starts instead of failing at import time.
  const flavors: FlavorManifestEntry[] = [];
  for (const flavor of sortFlavors(discoverFlavorFiles())) {
    flavors.push({
      flavor,
      branch: flavor,
      commit: "",
      version: "0.0.0.0",
      interfaceVersion: 0,
      generatedAt: "",
      counts: { systems: 0, functions: 0, events: 0, tables: 0 },
    });
  }
  return { formatVersion: DATA_FORMAT_VERSION, generatedAt: "", flavors };
}

export function manifest(): DataManifest {
  if (manifestCache) return manifestCache;
  const file = path.join(DATA_DIR, MANIFEST_FILE);
  let loaded: DataManifest;
  try {
    loaded = readJson<DataManifest>(file);
  } catch {
    loaded = buildFallbackManifest();
  }
  // Only serve flavors whose payload is actually on disk.
  loaded.flavors = loaded.flavors.filter((f) => flavorFile(f.flavor) !== undefined);
  const order = sortFlavors(loaded.flavors.map((f) => f.flavor));
  loaded.flavors.sort((a, b) => order.indexOf(a.flavor) - order.indexOf(b.flavor));
  manifestCache = loaded;
  return loaded;
}

/** Flavor IDs available in this installation, in curated display order. */
export function availableFlavors(): string[] {
  return manifest().flavors.map((f) => f.flavor);
}

export function isFlavor(id: string): boolean {
  return availableFlavors().includes(id);
}

export function flavorMeta(flavor: string): FlavorManifestEntry {
  const found = manifest().flavors.find((f) => f.flavor === flavor);
  if (!found) {
    throw new Error(`Unknown flavor "${flavor}". Available: ${availableFlavors().join(", ")}`);
  }
  return found;
}

/**
 * Fallback flavor, used when nothing better is known. Callers should prefer
 * `defaultFlavor()` from `src/default-flavor.ts`, which also consults the
 * local game install; it lives in its own module to keep this one free of a
 * dependency cycle through `src/install/`.
 */
export function fallbackFlavor(): string {
  const flavors = availableFlavors();
  if (flavors.length === 0) return "live";
  return flavors.includes("live") ? "live" : flavors[0]!;
}

/** Lowercased API names per flavor, for availability checks without a full load. */
function names(): Map<string, Set<string>> {
  if (namesCache) return namesCache;
  const file = path.join(DATA_DIR, NAMES_FILE);
  const map = new Map<string, Set<string>>();
  if (fs.existsSync(file)) {
    const raw = readJson<Record<string, string[]>>(file);
    for (const [flavor, list] of Object.entries(raw)) {
      map.set(flavor, new Set(list));
    }
  }
  namesCache = map;
  return map;
}

/** True when the flavor has a name index (so `hasName` is authoritative). */
export function hasNameIndex(flavor: string): boolean {
  return names().has(flavor);
}

export function hasName(flavor: string, name: string): boolean {
  return names().get(flavor)?.has(name.toLowerCase().trim()) ?? false;
}

/** Test seam: forget cached manifest/name data. */
export function resetManifestCache(): void {
  manifestCache = undefined;
  namesCache = undefined;
}
