/**
 * Offline integrity check for the contents of data/.
 *
 * Catches the failure modes a half-finished or hand-edited ingest produces:
 * a manifest that disagrees with the payloads, a stale name index, an entry
 * missing its computed fields. Runs in CI on every PR. Usage: npm run verify-data
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_FORMAT_VERSION } from "../src/data/manifest.js";
import { DATA_DIR, MANIFEST_FILE, NAMES_FILE, discoverFlavorFiles, flavorFile, readJson } from "../src/data/paths.js";
import { interfaceVersionFromBuild, type DataManifest, type FlavorData } from "../src/types.js";

const problems: string[] = [];
const fail = (message: string) => problems.push(message);

const manifestPath = path.join(DATA_DIR, MANIFEST_FILE);
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing ${MANIFEST_FILE} — run \`npm run ingest\`.`);
  process.exit(1);
}
const manifest = readJson<DataManifest>(manifestPath);
const names = readJson<Record<string, string[]>>(path.join(DATA_DIR, NAMES_FILE));

if (manifest.formatVersion !== DATA_FORMAT_VERSION) {
  fail(`manifest formatVersion is ${manifest.formatVersion}, code expects ${DATA_FORMAT_VERSION}`);
}
if (manifest.flavors.length === 0) fail("manifest lists no flavors");

const onDisk = new Set(discoverFlavorFiles());
const listed = new Set(manifest.flavors.map((f) => f.flavor));
for (const flavor of onDisk) {
  if (!listed.has(flavor)) fail(`data/${flavor}.json.gz exists but is not in the manifest`);
}

for (const entry of manifest.flavors) {
  const file = flavorFile(entry.flavor);
  if (!file) {
    fail(`${entry.flavor}: listed in the manifest with no payload on disk`);
    continue;
  }
  const data = readJson<FlavorData>(file);

  if (data.meta.flavor !== entry.flavor) {
    fail(`${entry.flavor}: payload meta.flavor is "${data.meta.flavor}"`);
  }
  if (data.meta.commit !== entry.commit) {
    fail(`${entry.flavor}: manifest commit ${entry.commit.slice(0, 10)} != payload ${data.meta.commit.slice(0, 10)}`);
  }
  if (data.meta.version !== entry.version) {
    fail(`${entry.flavor}: manifest build ${entry.version} != payload ${data.meta.version}`);
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(data.meta.version)) {
    fail(`${entry.flavor}: build "${data.meta.version}" is not a four-part version`);
  }
  if (entry.interfaceVersion !== interfaceVersionFromBuild(entry.version)) {
    fail(`${entry.flavor}: interfaceVersion ${entry.interfaceVersion} does not follow from build ${entry.version}`);
  }

  const counts = {
    systems: data.systems.length,
    functions: data.functions.length,
    events: data.events.length,
    tables: data.tables.length,
  };
  for (const [key, value] of Object.entries(counts) as Array<[keyof typeof counts, number]>) {
    if (entry.counts[key] !== value) {
      fail(`${entry.flavor}: manifest counts.${key}=${entry.counts[key]} but payload has ${value}`);
    }
    if (value === 0) fail(`${entry.flavor}: payload has zero ${key}`);
  }

  for (const [kind, list] of [
    ["function", data.functions],
    ["event", data.events],
    ["table", data.tables],
  ] as const) {
    const bad = list.find((e) => !e.QualifiedName || !e.System || !e.SourceFile);
    if (bad) fail(`${entry.flavor}: ${kind} entry missing computed fields: ${JSON.stringify(bad).slice(0, 120)}`);
  }

  const index = names[entry.flavor];
  if (!index) {
    fail(`${entry.flavor}: absent from ${NAMES_FILE}`);
  } else {
    const indexed = new Set(index);
    const expected = new Set<string>();
    for (const list of [data.functions, data.events, data.tables]) {
      for (const e of list) {
        for (const key of [e.QualifiedName, e.Name, e.LiteralName]) {
          if (typeof key === "string" && key) expected.add(key.toLowerCase());
        }
      }
    }
    const missing = [...expected].filter((n) => !indexed.has(n));
    const extra = [...indexed].filter((n) => !expected.has(n));
    if (missing.length > 0) fail(`${entry.flavor}: name index missing ${missing.length} name(s), e.g. ${missing[0]}`);
    if (extra.length > 0) fail(`${entry.flavor}: name index has ${extra.length} stale name(s), e.g. ${extra[0]}`);
  }

  console.log(
    `✓ ${entry.flavor.padEnd(21)} ${entry.version.padEnd(15)} iface ${String(entry.interfaceVersion).padEnd(7)} ` +
      `${counts.functions} functions, ${counts.events} events, ${counts.tables} tables`,
  );
}

for (const flavor of Object.keys(names)) {
  if (!listed.has(flavor)) fail(`${NAMES_FILE} has a stale entry for "${flavor}"`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`\n${manifest.flavors.length} track(s) verified.`);
