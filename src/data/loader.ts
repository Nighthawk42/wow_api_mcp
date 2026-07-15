/**
 * Loads data/<flavor>.json lazily and builds per-flavor search structures:
 * a MiniSearch full-text index and exact-name lookup maps.
 */
import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import { FLAVORS, type ApiEntry, type Flavor, type FlavorData } from "../types.js";

export type EntryKind = "function" | "event" | "table";

export interface IndexedEntry {
  id: string;
  kind: EntryKind;
  entry: ApiEntry;
}

export interface FlavorIndex {
  flavor: Flavor;
  data: FlavorData;
  mini: MiniSearch;
  byId: Map<string, IndexedEntry>;
  /** Lowercased QualifiedName / Name / LiteralName → entries. */
  byName: Map<string, IndexedEntry[]>;
}

const dataDir = path.resolve(import.meta.dirname, "..", "..", "data");
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

export function loadFlavor(flavor: Flavor): FlavorIndex {
  const cached = cache.get(flavor);
  if (cached) return cached;

  const file = path.join(dataDir, `${flavor}.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as FlavorData;

  const byId = new Map<string, IndexedEntry>();
  const byName = new Map<string, IndexedEntry[]>();
  const documents: Array<Record<string, string>> = [];

  const addName = (key: string | undefined, indexed: IndexedEntry) => {
    if (!key) return;
    const normalized = key.toLowerCase();
    const list = byName.get(normalized) ?? [];
    if (!list.includes(indexed)) {
      list.push(indexed);
      byName.set(normalized, list);
    }
  };

  const register = (kind: EntryKind, entries: ApiEntry[]) => {
    entries.forEach((entry, i) => {
      const id = `${kind}:${entry.QualifiedName}:${i}`;
      const indexed: IndexedEntry = { id, kind, entry };
      byId.set(id, indexed);
      addName(entry.QualifiedName, indexed);
      addName(entry.Name, indexed);
      addName(entry.LiteralName, indexed);
      documents.push({
        id,
        name: entry.QualifiedName,
        shortName: entry.Name ?? "",
        system: entry.System,
        text: documentationText(entry),
      });
    });
  };

  register("function", data.functions);
  register("event", data.events);
  register("table", data.tables);

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
  mini.addAll(documents);

  const index: FlavorIndex = { flavor, data, mini, byId, byName };
  cache.set(flavor, index);
  return index;
}

export function searchFlavor(flavor: Flavor, query: string, kind: EntryKind | "any", limit: number): IndexedEntry[] {
  const index = loadFlavor(flavor);
  const results = index.mini.search(query);
  const hits: IndexedEntry[] = [];
  for (const result of results) {
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

/** Which flavors contain an API with this name. */
export function availability(name: string): Map<Flavor, IndexedEntry[]> {
  const result = new Map<Flavor, IndexedEntry[]>();
  for (const flavor of FLAVORS) {
    result.set(flavor, lookupByName(flavor, name));
  }
  return result;
}
