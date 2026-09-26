/**
 * Discovers World of Warcraft installations on disk and works out which
 * wow-ui-source track each installed client corresponds to.
 *
 * Signals, strongest first:
 *   1. `<root>/.build.info`      — product code + exact build for installed products
 *   2. `<flavor>/.flavor.info`   — product code for that directory
 *   3. the client executable     — version resource (works when .build.info omits the product)
 *   4. a bundled Blizzard addon `.toc` — `## Interface` number
 *
 * Any path inside an install works as a starting point: the install root, a
 * `_retail_` directory, `Interface/AddOns`, or an addon folder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLIENT_EXECUTABLES, flavorSpec, knownFlavorSpecs } from "../flavors.js";
import { interfaceVersionFromBuild } from "../types.js";
import { readBuildInfo, readFlavorInfo } from "./build-info.js";
import { readPeVersion } from "./pe-version.js";
import { resolveFlavor, type ResolveResult } from "./resolve.js";
import { readAddonTocs } from "./toc.js";

export type VersionSource = "build.info" | "executable" | "toc" | "unknown";

export interface DetectedClient {
  /** Directory name inside the install root, e.g. `_retail_`. */
  directory: string;
  path: string;
  product?: string;
  /** Build string, e.g. "12.1.0.69814". */
  version?: string;
  interfaceVersion?: number;
  versionSource: VersionSource;
  executable?: string;
  /** False for leftover directories that hold only addon/WTF data, no client. */
  clientPresent: boolean;
  resolution: ResolveResult;
}

export interface DetectedInstall {
  root: string;
  clients: DetectedClient[];
}

const KNOWN_INSTALL_DIRS = new Set(knownFlavorSpecs().flatMap((s) => s.installDirs));

function isInstallRoot(dir: string): boolean {
  if (fs.existsSync(path.join(dir, ".build.info"))) return true;
  return flavorDirs(dir).length > 0;
}

function flavorDirs(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^_.+_$/.test(n) || KNOWN_INSTALL_DIRS.has(n))
    .filter((n) => {
      try {
        return fs.statSync(path.join(root, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Blizzard packs builds above 65535 into the 16-bit version-resource fields as
 * decimal digit groups: 12.1.0.69814 is stored as 1201.0.6981.4. Unpack that
 * shape and pass anything else through unchanged.
 */
export function decodeExeVersion(fileVersion: string): string {
  const parts = fileVersion.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return fileVersion;
  const [a, b, c, d] = parts as [number, number, number, number];
  if (d <= 9 && c >= 1000 && a >= 100) {
    return [Math.floor(a / 100), a % 100, b, c * 10 + d].join(".");
  }
  return fileVersion;
}

/** Walks up from any path inside an install to the directory holding the flavor folders. */
export function findInstallRoot(startPath: string): string | undefined {
  let current = path.resolve(startPath);
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    return undefined;
  }
  for (let i = 0; i < 12; i++) {
    if (isInstallRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function findExecutable(clientDir: string): { name: string; version?: string } | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(clientDir);
  } catch {
    return undefined;
  }
  const known = new Set(CLIENT_EXECUTABLES.map((e) => e.toLowerCase()));
  // Prefer a known client name; otherwise any Wow*.exe that is not a helper.
  const candidates = names.filter((n) => known.has(n.toLowerCase()));
  for (const name of names) {
    if (/^wow.*\.exe$/i.test(name) && !/loader|error|launcher/i.test(name) && !candidates.includes(name)) {
      candidates.push(name);
    }
  }
  for (const name of candidates) {
    const pe = readPeVersion(path.join(clientDir, name));
    if (pe) return { name, version: decodeExeVersion(pe.fileVersion) };
  }
  return candidates[0] ? { name: candidates[0] } : undefined;
}

/** Highest interface number found in the client's bundled Blizzard addons. */
function interfaceFromBundledAddons(clientDir: string): number | undefined {
  const addonsDir = path.join(clientDir, "Interface", "AddOns");
  let entries: string[];
  try {
    entries = fs.readdirSync(addonsDir);
  } catch {
    return undefined;
  }
  const versions: number[] = [];
  for (const entry of entries.slice(0, 400)) {
    for (const toc of readAddonTocs(path.join(addonsDir, entry))) {
      versions.push(...toc.interfaceVersions);
    }
    if (versions.length >= 5) break;
  }
  if (versions.length === 0) return undefined;
  // Bundled Blizzard addons all carry the live interface number; user addons
  // may lag, so take the most common value rather than the maximum.
  const counts = new Map<number, number>();
  for (const v of versions) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
}

/** Inspects one installation root and resolves every client directory it holds. */
export function inspectInstall(root: string): DetectedInstall {
  const buildInfo = readBuildInfo(root);
  const byProduct = new Map(buildInfo.filter((r) => r.version).map((r) => [r.product, r]));
  const clients: DetectedClient[] = [];

  for (const directory of flavorDirs(root)) {
    const clientPath = path.join(root, directory);
    const product = readFlavorInfo(clientPath);
    const exe = findExecutable(clientPath);

    let version: string | undefined;
    let versionSource: VersionSource = "unknown";
    const fromBuildInfo = product ? byProduct.get(product) : undefined;
    if (fromBuildInfo?.version) {
      version = fromBuildInfo.version;
      versionSource = "build.info";
    } else if (exe?.version) {
      version = exe.version;
      versionSource = "executable";
    }

    let interfaceVersion = version ? interfaceVersionFromBuild(version) : undefined;
    if (!version) {
      const fromToc = interfaceFromBundledAddons(clientPath);
      if (fromToc) {
        interfaceVersion = fromToc;
        versionSource = "toc";
      }
    }

    const clientPresent = Boolean(product || exe);
    clients.push({
      directory,
      path: clientPath,
      product,
      version,
      interfaceVersion,
      versionSource,
      executable: exe?.name,
      clientPresent,
      // A directory with no client is a leftover addon/WTF folder; its stale
      // .toc numbers must not be treated as evidence of an installed build.
      resolution: clientPresent
        ? resolveFlavor({ product, version, interfaceVersion, installDir: directory })
        : { candidates: [], confidence: "none" },
    });
  }

  // A product listed in .build.info without its own directory (a partially
  // installed client) is still worth reporting.
  for (const row of buildInfo) {
    if (clients.some((c) => c.product === row.product)) continue;
    const spec = knownFlavorSpecs().find((s) => s.products.includes(row.product));
    clients.push({
      directory: spec?.installDirs[0] ?? row.product,
      path: root,
      product: row.product,
      version: row.version || undefined,
      interfaceVersion: row.version ? interfaceVersionFromBuild(row.version) : undefined,
      versionSource: row.version ? "build.info" : "unknown",
      clientPresent: true,
      resolution: resolveFlavor({ product: row.product, version: row.version }),
    });
  }

  return { root, clients };
}

/** Common install locations per platform, plus `WOW_INSTALL_PATH`. */
export function candidateInstallPaths(): string[] {
  const paths: string[] = [];
  const env = process.env.WOW_INSTALL_PATH?.trim();
  if (env) paths.push(...env.split(path.delimiter).filter(Boolean));

  const relative = [
    "World of Warcraft",
    "Games/World of Warcraft",
    "Program Files (x86)/World of Warcraft",
    "Program Files/World of Warcraft",
    "Battle.net/World of Warcraft",
  ];

  if (process.platform === "win32") {
    for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (!fs.existsSync(drive)) continue;
      for (const rel of relative) paths.push(path.join(drive, rel));
    }
  } else if (process.platform === "darwin") {
    paths.push("/Applications/World of Warcraft");
  } else {
    const home = os.homedir();
    paths.push(
      path.join(home, "Games/world-of-warcraft/drive_c/Program Files (x86)/World of Warcraft"),
      path.join(home, ".wine/drive_c/Program Files (x86)/World of Warcraft"),
      path.join(home, "Games/World of Warcraft"),
    );
  }
  return [...new Set(paths.map((p) => path.resolve(p)))];
}

/**
 * Finds installs. With `startPath` it walks up from that path; otherwise it
 * probes the usual locations for the platform.
 */
export function detectInstalls(startPath?: string): DetectedInstall[] {
  const roots: string[] = [];
  if (startPath) {
    const root = findInstallRoot(startPath);
    if (root) roots.push(root);
  } else {
    for (const candidate of candidateInstallPaths()) {
      if (isInstallRoot(candidate)) roots.push(candidate);
    }
  }
  return [...new Set(roots)].map(inspectInstall);
}

export { flavorSpec };
