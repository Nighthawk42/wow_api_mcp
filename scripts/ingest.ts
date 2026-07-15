/**
 * Regenerates data/<flavor>.json from Gethe/wow-ui-source.
 *
 * For each flavor branch this makes (or updates) a shallow sparse clone
 * containing only Blizzard_APIDocumentationGenerated, parses every Lua doc
 * file, and writes the normalized FlavorData JSON. Usage:
 *
 *   npm run ingest              # all four flavors
 *   npm run ingest -- live      # a subset
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import envPaths from "env-paths";
import { DOCS_PATH, FLAVORS, UPSTREAM_REPO, type Flavor, type FlavorData } from "../src/types.js";
import { parseDocumentationFile } from "../src/lua/parse-docs.js";
import { emptyNormalizedDocs, normalizeDocTables } from "../src/lua/normalize.js";

const ingestRoot = path.join(envPaths("wow-api-mcp", { suffix: "" }).cache, "ingest");
const dataDir = path.resolve(import.meta.dirname, "..", "data");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function ensureDocsCheckout(branch: string): string {
  const dir = path.join(ingestRoot, branch);
  if (fs.existsSync(path.join(dir, ".git"))) {
    git(dir, "fetch", "--depth", "1", "origin", branch);
    git(dir, "reset", "--hard", "FETCH_HEAD");
  } else {
    fs.mkdirSync(ingestRoot, { recursive: true });
    git(ingestRoot, "clone", "--depth", "1", "--branch", branch, "--filter=blob:none", "--sparse", UPSTREAM_REPO, branch);
    git(dir, "sparse-checkout", "set", DOCS_PATH);
  }
  return dir;
}

function interfaceVersionFromBuild(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return major * 10000 + minor * 100 + patch;
}

function ingestFlavor(flavor: Flavor): FlavorData {
  console.log(`[${flavor}] updating checkout...`);
  const dir = ensureDocsCheckout(flavor);
  const commit = git(dir, "rev-parse", "HEAD");
  const version = fs.readFileSync(path.join(dir, "version.txt"), "utf8").trim();

  const docsDir = path.join(dir, DOCS_PATH);
  const luaFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith(".lua")).sort();

  const docs = emptyNormalizedDocs();
  const failures: string[] = [];
  for (const file of luaFiles) {
    const source = fs.readFileSync(path.join(docsDir, file), "utf8");
    try {
      normalizeDocTables(parseDocumentationFile(source), file, docs);
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`[${flavor}] ${failures.length} file(s) failed to parse:\n  ${failures.join("\n  ")}`);
  }

  const byName = (a: { Name?: string }, b: { Name?: string }) => (a.Name ?? "").localeCompare(b.Name ?? "");
  const byQualified = (a: { QualifiedName: string }, b: { QualifiedName: string }) =>
    a.QualifiedName.localeCompare(b.QualifiedName);
  docs.systems.sort(byName);
  docs.functions.sort(byQualified);
  docs.events.sort(byQualified);
  docs.tables.sort(byQualified);

  console.log(
    `[${flavor}] ${version} @ ${commit.slice(0, 10)}: ` +
      `${docs.systems.length} systems, ${docs.functions.length} functions, ` +
      `${docs.events.length} events, ${docs.tables.length} tables`,
  );

  return {
    meta: {
      flavor,
      branch: flavor,
      commit,
      version,
      interfaceVersion: interfaceVersionFromBuild(version),
      generatedAt: new Date().toISOString(),
    },
    ...docs,
  };
}

const requested = process.argv.slice(2);
const flavors = requested.length > 0 ? (requested as Flavor[]) : [...FLAVORS];
for (const flavor of flavors) {
  if (!FLAVORS.includes(flavor)) {
    console.error(`Unknown flavor "${flavor}". Valid: ${FLAVORS.join(", ")}`);
    process.exit(1);
  }
}

fs.mkdirSync(dataDir, { recursive: true });
for (const flavor of flavors) {
  const data = ingestFlavor(flavor);
  const outFile = path.join(dataDir, `${flavor}.json`);
  fs.writeFileSync(outFile, JSON.stringify(data, null, "\t") + "\n");
  console.log(`[${flavor}] wrote ${outFile} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
}
