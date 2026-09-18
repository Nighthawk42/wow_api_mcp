/**
 * Regenerates data/ from Gethe/wow-ui-source.
 *
 * Every upstream branch that ships Blizzard_APIDocumentationGenerated is a
 * "track" (= flavor). Branches are discovered with `git ls-remote`, so a new
 * upstream track is picked up without a code change. For each one this makes
 * (or updates) a shallow sparse clone containing only the docs directory,
 * parses every Lua doc file, and writes a gzipped FlavorData payload plus the
 * shared `_manifest.json` / `_names.json.gz` index files.
 *
 *   npm run ingest                 # every discovered track
 *   npm run ingest -- live ptr     # a subset
 *   npm run ingest -- --list       # show what would be ingested
 *   npm run ingest -- --prune      # also delete data for vanished branches
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import envPaths from "env-paths";
import {
  DOCS_PATH,
  UPSTREAM_REPO,
  interfaceVersionFromBuild,
  type DataManifest,
  type FlavorData,
  type FlavorManifestEntry,
} from "../src/types.js";
import { IGNORED_BRANCHES, sortFlavors } from "../src/flavors.js";
import { DATA_FORMAT_VERSION } from "../src/data/manifest.js";
import { DATA_DIR, MANIFEST_FILE, NAMES_FILE, readJson, writeJson } from "../src/data/paths.js";
import { parseDocumentationFile } from "../src/lua/parse-docs.js";
import { emptyNormalizedDocs, normalizeDocTables } from "../src/lua/normalize.js";

const ingestRoot = path.join(envPaths("wow-api-mcp", { suffix: "" }).cache, "ingest");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function remoteBranches(): string[] {
  const output = execFileSync("git", ["ls-remote", "--heads", UPSTREAM_REPO], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return output
    .split("\n")
    .map((line) => line.split("\t")[1]?.replace(/^refs\/heads\//, "").trim())
    .filter((b): b is string => Boolean(b) && !IGNORED_BRANCHES.has(b));
}

function ensureDocsCheckout(branch: string): string {
  const dir = path.join(ingestRoot, branch);
  if (fs.existsSync(path.join(dir, ".git"))) {
    git(dir, "fetch", "--depth", "1", "origin", branch);
    git(dir, "reset", "--hard", "FETCH_HEAD");
    git(dir, "clean", "-fd");
  } else {
    fs.mkdirSync(ingestRoot, { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    git(ingestRoot, "clone", "--depth", "1", "--branch", branch, "--filter=blob:none", "--sparse", UPSTREAM_REPO, branch);
    git(dir, "sparse-checkout", "set", DOCS_PATH);
  }
  return dir;
}

function ingestFlavor(flavor: string): FlavorData {
  const dir = ensureDocsCheckout(flavor);
  const commit = git(dir, "rev-parse", "HEAD");
  // Upstream commit date, not wall clock, so re-ingesting unchanged sources
  // produces byte-identical output (keeps the auto-refresh commits quiet).
  const commitDate = git(dir, "log", "-1", "--format=%cI");
  const versionFile = path.join(dir, "version.txt");
  const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf8").trim() : "0.0.0.0";

  const docsDir = path.join(dir, DOCS_PATH);
  if (!fs.existsSync(docsDir)) throw new Error(`branch has no ${DOCS_PATH}`);

  const luaFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith(".lua")).sort();
  if (luaFiles.length === 0) throw new Error(`no .lua documentation files in ${DOCS_PATH}`);

  const docs = emptyNormalizedDocs();
  const failures: string[] = [];
  const empty: string[] = [];
  for (const file of luaFiles) {
    const source = fs.readFileSync(path.join(docsDir, file), "utf8");
    try {
      const tables = parseDocumentationFile(source);
      // A file that yields nothing parsed fine but matched no shape we
      // recognise — a silent gap, so surface it rather than dropping the file.
      if (tables.length === 0) empty.push(file);
      normalizeDocTables(tables, file, docs);
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} file(s) failed to parse:\n    ${failures.join("\n    ")}`);
  }
  if (empty.length > 0) {
    throw new Error(
      `${empty.length} file(s) produced no documentation tables (unrecognised shape):\n    ${empty.join("\n    ")}`,
    );
  }

  const byName = (a: { Name?: string }, b: { Name?: string }) => (a.Name ?? "").localeCompare(b.Name ?? "");
  const byQualified = (a: { QualifiedName: string }, b: { QualifiedName: string }) =>
    a.QualifiedName.localeCompare(b.QualifiedName);
  docs.systems.sort(byName);
  docs.functions.sort(byQualified);
  docs.events.sort(byQualified);
  docs.tables.sort(byQualified);

  return {
    meta: {
      flavor,
      branch: flavor,
      commit,
      version,
      interfaceVersion: interfaceVersionFromBuild(version),
      generatedAt: commitDate,
    },
    ...docs,
  };
}

/** Every name a caller might look an entry up by, lowercased and sorted. */
function nameIndexFor(data: FlavorData): string[] {
  const names = new Set<string>();
  for (const list of [data.functions, data.events, data.tables]) {
    for (const entry of list) {
      for (const key of [entry.QualifiedName, entry.Name, entry.LiteralName]) {
        if (typeof key === "string" && key) names.add(key.toLowerCase());
      }
    }
  }
  return [...names].sort();
}

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const prune = args.includes("--prune");
const requested = args.filter((a) => !a.startsWith("--"));

const discovered = sortFlavors(remoteBranches());
const flavors = requested.length > 0 ? requested : discovered;

for (const flavor of requested) {
  if (!discovered.includes(flavor)) {
    console.error(`Unknown branch "${flavor}". Upstream has: ${discovered.join(", ")}`);
    process.exit(1);
  }
}

if (listOnly) {
  console.log(`${discovered.length} track(s) upstream:\n${discovered.map((f) => `  ${f}`).join("\n")}`);
  process.exit(0);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// Start from the existing manifest so a partial run (`npm run ingest -- live`)
// keeps the entries for tracks it did not touch.
let existing: DataManifest | undefined;
try {
  existing = readJson<DataManifest>(path.join(DATA_DIR, MANIFEST_FILE));
} catch {
  existing = undefined;
}
let allNames: Record<string, string[]> = {};
try {
  allNames = readJson<Record<string, string[]>>(path.join(DATA_DIR, NAMES_FILE));
} catch {
  allNames = {};
}

const entries = new Map<string, FlavorManifestEntry>((existing?.flavors ?? []).map((f) => [f.flavor, f]));
const failed: string[] = [];

for (const flavor of flavors) {
  process.stdout.write(`[${flavor}] updating checkout... `);
  try {
    const data = ingestFlavor(flavor);
    const outFile = path.join(DATA_DIR, `${flavor}.json.gz`);
    writeJson(outFile, data);
    fs.rmSync(path.join(DATA_DIR, `${flavor}.json`), { force: true }); // legacy uncompressed payload
    allNames[flavor] = nameIndexFor(data);
    entries.set(flavor, {
      ...data.meta,
      counts: {
        systems: data.systems.length,
        functions: data.functions.length,
        events: data.events.length,
        tables: data.tables.length,
      },
    });
    console.log(
      `${data.meta.version} @ ${data.meta.commit.slice(0, 10)}: ` +
        `${data.systems.length} systems, ${data.functions.length} functions, ` +
        `${data.events.length} events, ${data.tables.length} tables ` +
        `(${(fs.statSync(outFile).size / 1024).toFixed(0)} KB gz)`,
    );
  } catch (error) {
    // One broken track (a PTR branch caught mid-push, say) must not sink the rest.
    failed.push(flavor);
    console.log("FAILED");
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (prune) {
  for (const flavor of [...entries.keys()]) {
    if (discovered.includes(flavor)) continue;
    console.log(`[${flavor}] branch gone upstream - removing data`);
    entries.delete(flavor);
    delete allNames[flavor];
    fs.rmSync(path.join(DATA_DIR, `${flavor}.json.gz`), { force: true });
    fs.rmSync(path.join(DATA_DIR, `${flavor}.json`), { force: true });
  }
}

const ordered = sortFlavors([...entries.keys()]);
const manifest: DataManifest = {
  formatVersion: DATA_FORMAT_VERSION,
  // Newest upstream commit date, so the manifest is stable across re-runs.
  generatedAt: ordered.map((f) => entries.get(f)!.generatedAt).sort().at(-1) ?? "",
  flavors: ordered.map((f) => entries.get(f)!),
};
writeJson(path.join(DATA_DIR, MANIFEST_FILE), manifest);
writeJson(
  path.join(DATA_DIR, NAMES_FILE),
  Object.fromEntries(ordered.filter((f) => allNames[f]).map((f) => [f, allNames[f]!])),
);
console.log(`\nwrote ${MANIFEST_FILE} + ${NAMES_FILE} for ${ordered.length} track(s): ${ordered.join(", ")}`);

if (failed.length > 0) {
  console.error(`\n${failed.length} track(s) failed: ${failed.join(", ")}`);
  process.exit(1);
}
