/** Resolves the bundled `data/` directory and its file naming. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** Data lives next to the compiled output: dist/data/.. and src/data/.. both resolve to <pkg>/data. */
export const DATA_DIR = process.env.WOW_API_MCP_DATA_DIR
  ? path.resolve(process.env.WOW_API_MCP_DATA_DIR)
  : path.resolve(import.meta.dirname, "..", "..", "data");

export const MANIFEST_FILE = "_manifest.json";
export const NAMES_FILE = "_names.json.gz";

/** Flavor payloads are gzipped (~13:1); a plain `.json` is still accepted. */
export function flavorFile(flavor: string): string | undefined {
  for (const name of [`${flavor}.json.gz`, `${flavor}.json`]) {
    const file = path.join(DATA_DIR, name);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

/** Reads a data file as text, transparently gunzipping a `.gz`. */
export function readText(file: string): string {
  const raw = fs.readFileSync(file);
  return file.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8");
}

export function readJson<T>(file: string): T {
  return JSON.parse(readText(file)) as T;
}

/**
 * Writes a data file, skipping the write when the decompressed content already
 * matches. Returns true when the file actually changed.
 *
 * Comparing content rather than bytes is the whole point: gzip output is *not*
 * stable across zlib builds, so the same input compressed on a Windows dev box
 * and on the Linux refresh runner differs by a byte or two. Rewriting
 * unconditionally would make the daily job commit megabytes of churn forever
 * without a single API having changed.
 */
export function writeJson(file: string, value: unknown): boolean {
  // Small uncompressed files (the manifest) stay pretty-printed so their diffs
  // are readable in the auto-refresh commits; payloads are minified then gzipped.
  const text = (file.endsWith(".gz") ? JSON.stringify(value) : JSON.stringify(value, null, 2)) + "\n";
  try {
    if (readText(file) === text) return false;
  } catch {
    // Missing or unreadable — fall through and write it.
  }
  fs.writeFileSync(
    file,
    file.endsWith(".gz") ? zlib.gzipSync(Buffer.from(text, "utf8"), { level: 9 }) : text,
  );
  return true;
}

/** Flavor IDs present in the data directory, unordered. */
export function discoverFlavorFiles(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const ids = new Set<string>();
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (name.startsWith("_")) continue;
    const match = /^(.+?)\.json(\.gz)?$/.exec(name);
    if (match) ids.add(match[1]!);
  }
  return [...ids];
}
