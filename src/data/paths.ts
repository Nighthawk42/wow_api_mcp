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

export function readJson<T>(file: string): T {
  const raw = fs.readFileSync(file);
  const text = file.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return JSON.parse(text) as T;
}

export function writeJson(file: string, value: unknown): void {
  const text = JSON.stringify(value) + "\n";
  if (file.endsWith(".gz")) {
    // Node writes a zero MTIME in the gzip header, so identical input yields
    // identical bytes and an unchanged track produces no refresh commit.
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(text, "utf8"), { level: 9 }));
  } else {
    fs.writeFileSync(file, text);
  }
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
