/**
 * Reads the `## Interface:` directive out of addon `.toc` files.
 *
 * An addon directory may hold one `.toc` per game line — `Foo.toc`,
 * `Foo_Mainline.toc`, `Foo_Vanilla.toc`, `Foo_Mists.toc`, ... — each naming
 * the interface number(s) it supports, so a single addon folder can tell us
 * every flavor it targets.
 */
import fs from "node:fs";
import path from "node:path";

export interface TocInfo {
  file: string;
  /** Addon name, i.e. the .toc basename without its flavor suffix. */
  addon: string;
  /** Suffix such as `Mainline`, `Vanilla`, `Cata`; undefined for a plain .toc. */
  suffix?: string;
  interfaceVersions: number[];
  title?: string;
}

/** Suffixes Blizzard's loader recognises, mapped to the line they select. */
export const TOC_SUFFIXES: Record<string, string> = {
  Mainline: "retail",
  Standard: "retail",
  Vanilla: "classic_era",
  Classic: "classic_era",
  TBC: "classic",
  BCC: "classic",
  Wrath: "classic",
  WOTLKC: "classic",
  Cata: "classic",
  Mists: "classic",
  MoP: "classic",
};

function directive(lines: string[], name: string): string | undefined {
  const needle = `## ${name.toLowerCase()}:`;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(needle)) return trimmed.slice(needle.length).trim();
  }
  return undefined;
}

export function parseToc(file: string): TocInfo | undefined {
  let text: string;
  try {
    // .toc files are small; read only the header region.
    text = fs.readFileSync(file, "utf8").slice(0, 8192);
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  const interfaceVersions = (directive(lines, "Interface") ?? "")
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0);

  const base = path.basename(file).replace(/\.toc$/i, "");
  const match = /^(.*)[-_]([A-Za-z]+)$/.exec(base);
  const suffix = match && TOC_SUFFIXES[match[2]!] ? match[2] : undefined;
  return {
    file,
    addon: suffix ? match![1]! : base,
    suffix,
    interfaceVersions,
    title: directive(lines, "Title"),
  };
}

/** All `.toc` files directly inside an addon directory. */
export function readAddonTocs(addonDir: string): TocInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(addonDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.toLowerCase().endsWith(".toc"))
    .map((n) => parseToc(path.join(addonDir, n)))
    .filter((t): t is TocInfo => t !== undefined && t.interfaceVersions.length > 0);
}
