/**
 * Loads flavor payloads on demand and builds per-flavor search structures.
 *
 * Loading is two-tier because there are a dozen flavors and each payload is
 * several megabytes parsed:
 *   - `loadFlavor` parses the JSON and builds the exact-name lookup maps.
 *   - `searchFlavor` additionally builds the MiniSearch index, which is the
 *     expensive part, and only for flavors actually searched.
 * A small LRU bounds resident memory; `WOW_API_MCP_CACHE_FLAVORS` tunes it.
 */
import MiniSearch from "minisearch";
import type { ApiEntry, Flavor, FlavorData } from "../types.js";
import { availableFlavors, hasName, hasNameIndex } from "./manifest.js";
import { flavorFile, readJson } from "./paths.js";

export type EntryKind = "function" | "event" | "table";

export interface IndexedEntry {
  id: string;
  kind: EntryKind;
  entry: ApiEntry;
}

export interface FlavorIndex {
  flavor: Flavor;
  data: FlavorData;
  byId: Map<string, IndexedEntry>;
  /** Lowercased QualifiedName / Name / LiteralName → entries. */
  byName: Map<string, IndexedEntry[]>;
  /** Built lazily by `searchIndex`. */
  mini?: MiniSearch;
}

const MAX_RESIDENT = Math.max(1, Number(process.env.WOW_API_MCP_CACHE_FLAVORS ?? 4) || 4);
const cache = new Map<Flavor, FlavorIndex>();

/** Splits identifiers on separators and camelCase so "C_Timer.After" and "GetItemInfo" both tokenize naturally. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean);
}

function documentationText(entry: ApiEntry): string {
  const parts: string[] = [];
  if (Array.isArray(entry.Documentation)) parts.push(...entry.Documentation);
  for (const list of [entry.Arguments, entry.Returns, entry.Payload, entry.Fields, entry.Values]) {
    if (Array.isArray(list)) {
      for (const field of list) if (field.Name) parts.push(String(field.Name));
    }
  }
  return parts.join(" ");
}

function touch(flavor: Flavor, index: FlavorIndex): FlavorIndex {
  // Map preserves insertion order: re-inserting moves the entry to the back.
  cache.delete(flavor);
  cache.set(flavor, index);
  while (cache.size > MAX_RESIDENT) {
    const oldest = cache.keys().next();
    if (oldest.done || oldest.value === flavor) break;
    cache.delete(oldest.value);
  }
  return index;
}

export function loadFlavor(flavor: Flavor): FlavorIndex {
  const cached = cache.get(flavor);
  if (cached) return touch(flavor, cached);

  const file = flavorFile(flavor);
  if (!file) {
    throw new Error(`Unknown flavor "${flavor}". Available: ${availableFlavors().join(", ")}`);
  }
  const data = readJson<FlavorData>(file);

  const byId = new Map<string, IndexedEntry>();
  const byName = new Map<string, IndexedEntry[]>();

  const addName = (key: string | undefined, indexed: IndexedEntry) => {
    if (!key) return;
    const normalized = key.toLowerCase();
    const list = byName.get(normalized);
    if (!list) byName.set(normalized, [indexed]);
    else if (!list.includes(indexed)) list.push(indexed);
  };

  const register = (kind: EntryKind, entries: ApiEntry[]) => {
    entries.forEach((entry, i) => {
      const indexed: IndexedEntry = { id: `${kind}:${entry.QualifiedName}:${i}`, kind, entry };
      byId.set(indexed.id, indexed);
      addName(entry.QualifiedName, indexed);
      addName(entry.Name, indexed);
      addName(entry.LiteralName, indexed);
    });
  };

  register("function", data.functions);
  register("event", data.events);
  register("table", data.tables);

  return touch(flavor, { flavor, data, byId, byName });
}

/** Builds (once per resident load) the full-text index for a flavor. */
function searchIndex(index: FlavorIndex): MiniSearch {
  if (index.mini) return index.mini;
  const mini = new MiniSearch({
    fields: ["name", "shortName", "system", "text"],
    storeFields: [],
    tokenize,
    searchOptions: {
      boost: { name: 4, shortName: 3, system: 1.5 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: "AND",
    },
  });
  mini.addAll(
    [...index.byId.values()].map(({ id, entry }) => ({
      id,
      name: entry.QualifiedName,
      shortName: entry.Name ?? "",
      system: entry.System,
      text: documentationText(entry),
    })),
  );
  index.mini = mini;
  return mini;
}

export function searchFlavor(
  flavor: Flavor,
  query: string,
  kind: EntryKind | "any",
  limit: number,
): IndexedEntry[] {
  const index = loadFlavor(flavor);
  const hits: IndexedEntry[] = [];
  for (const result of searchIndex(index).search(query)) {
    const indexed = index.byId.get(String(result.id));
    if (!indexed) continue;
    if (kind !== "any" && indexed.kind !== kind) continue;
    hits.push(indexed);
    if (hits.length >= limit) break;
  }
  return hits;
}

export function lookupByName(flavor: Flavor, name: string): IndexedEntry[] {
  return loadFlavor(flavor).byName.get(name.toLowerCase().trim()) ?? [];
}

/**
 * Which flavors contain an API with this name. Uses the pre-built name index
 * so it never has to parse every flavor payload; falls back to a full load for
 * flavors missing from the index.
 */
export function availability(name: string, flavors: readonly Flavor[] = availableFlavors()): Map<Flavor, boolean> {
  const result = new Map<Flavor, boolean>();
  for (const flavor of flavors) {
    result.set(flavor, hasNameIndex(flavor) ? hasName(flavor, name) : lookupByName(flavor, name).length > 0);
  }
  return result;
}

/** All entry names in a flavor, deduplicated and lowercased — used by `diff_flavors`. */
export function entryNames(flavor: Flavor, kind: EntryKind | "any"): Map<string, IndexedEntry> {
  const index = loadFlavor(flavor);
  const out = new Map<string, IndexedEntry>();
  for (const indexed of index.byId.values()) {
    if (kind !== "any" && indexed.kind !== kind) continue;
    const key = indexed.entry.QualifiedName;
    if (key && !out.has(key)) out.set(key, indexed);
  }
  return out;
}

/** Test seam: drop resident flavors. */
export function resetLoaderCache(): void {
  cache.clear();
}
