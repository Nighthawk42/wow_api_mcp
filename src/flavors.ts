/**
 * Static metadata for every wow-ui-source branch ("track") we ingest.
 *
 * Flavor IDs are exactly the upstream branch names — never invent aliases.
 * This table only carries presentation and install-detection hints; which
 * flavors are actually *available* is decided by what `data/` contains
 * (see `src/data/manifest.ts`), so a new upstream branch becomes a working
 * flavor as soon as the ingest job writes its data file.
 */

export type FlavorChannel = "release" | "ptr" | "beta";

/** Broad game line, used for grouping and for narrowing install matches. */
export type FlavorLine = "retail" | "classic" | "classic_era" | "other";

export interface FlavorSpec {
  /** Upstream branch name; also the flavor ID exposed by the tools. */
  id: string;
  label: string;
  line: FlavorLine;
  channel: FlavorChannel;
  /** Blizzard product codes seen in `.flavor.info` / `.build.info`. */
  products: string[];
  /** Install sub-directory names, e.g. `_retail_`. */
  installDirs: string[];
  /** Client executables found in those directories. */
  executables: string[];
  description: string;
}

/** Upstream branches that carry no game data and must never be ingested. */
export const IGNORED_BRANCHES = new Set(["automation", "gh-pages", "master"]);

const SPECS: FlavorSpec[] = [
  {
    id: "live",
    label: "Retail",
    line: "retail",
    channel: "release",
    products: ["wow"],
    installDirs: ["_retail_"],
    executables: ["Wow.exe", "World of Warcraft.app"],
    description: "Live retail client — the current expansion on live realms.",
  },
  {
    id: "ptr",
    label: "Retail PTR",
    line: "retail",
    channel: "ptr",
    products: ["wowt"],
    installDirs: ["_ptr_"],
    executables: ["WowT.exe"],
    description: "Retail public test realm.",
  },
  {
    id: "ptr2",
    label: "Retail PTR 2 (XPTR)",
    line: "retail",
    channel: "ptr",
    products: ["wowxptr"],
    installDirs: ["_xptr_"],
    executables: ["WowT.exe"],
    description: "Second retail test realm, usually a patch ahead of `ptr`.",
  },
  {
    id: "beta",
    label: "Retail Beta",
    line: "retail",
    channel: "beta",
    products: ["wow_beta"],
    installDirs: ["_beta_"],
    executables: ["WowB.exe"],
    description: "Retail expansion beta.",
  },
  {
    id: "classic",
    label: "Classic (current expansion)",
    line: "classic",
    channel: "release",
    products: ["wow_classic"],
    installDirs: ["_classic_"],
    executables: ["WowClassic.exe"],
    description: "Progression Classic — whichever expansion Classic realms are on.",
  },
  {
    id: "classic_ptr",
    label: "Classic PTR",
    line: "classic",
    channel: "ptr",
    products: ["wow_classic_ptr"],
    installDirs: ["_classic_ptr_"],
    executables: ["WowClassicT.exe"],
    description: "Progression Classic public test realm.",
  },
  {
    id: "classic_beta",
    label: "Classic Beta",
    line: "classic",
    channel: "beta",
    products: ["wow_classic_beta"],
    installDirs: ["_classic_beta_"],
    executables: ["WowClassicB.exe", "WowB.exe"],
    description: "Progression Classic beta.",
  },
  {
    id: "classic_era",
    label: "Classic Era (vanilla)",
    line: "classic_era",
    channel: "release",
    products: ["wow_classic_era"],
    installDirs: ["_classic_era_"],
    executables: ["WowClassic.exe"],
    description: "Classic Era / Hardcore — permanent vanilla realms.",
  },
  {
    id: "classic_era_ptr",
    label: "Classic Era PTR",
    line: "classic_era",
    channel: "ptr",
    products: ["wow_classic_era_ptr"],
    installDirs: ["_classic_era_ptr_"],
    executables: ["WowClassicT.exe"],
    description: "Classic Era test realm; also used for Anniversary PTR builds.",
  },
  {
    id: "classic_anniversary",
    label: "Classic Anniversary",
    line: "classic_era",
    channel: "release",
    products: ["wow_classic_era"],
    installDirs: ["_anniversary_", "_classic_era_"],
    executables: ["WowClassic.exe"],
    description: "Anniversary realms running on the Classic Era client line.",
  },
  {
    id: "classic_titan",
    label: "Classic Titan",
    line: "other",
    channel: "beta",
    products: [],
    installDirs: [],
    executables: [],
    description: "Internal Blizzard track mirrored upstream; no public client.",
  },
  {
    id: "forever",
    label: "WoW Forever",
    line: "other",
    channel: "beta",
    products: ["wow_classic_beta"],
    installDirs: ["_classic_beta_"],
    executables: ["WowB.exe", "WowClassicB.exe"],
    description: "The 1.60 'Forever' track; currently ships in the Classic beta slot.",
  },
];

const byId = new Map(SPECS.map((s) => [s.id, s]));

/** Display/ordering priority — release lines first, then test realms. */
const ORDER = SPECS.map((s) => s.id);

export function flavorSpec(id: string): FlavorSpec {
  return (
    byId.get(id) ?? {
      id,
      label: id,
      line: "other",
      channel: "release",
      products: [],
      installDirs: [],
      executables: [],
      description: `Upstream branch \`${id}\`.`,
    }
  );
}

export function knownFlavorSpecs(): FlavorSpec[] {
  return [...SPECS];
}

/** Sorts flavor IDs into the curated order, with unknown branches appended alphabetically. */
export function sortFlavors(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

/** All client executable names we know about, for install detection. */
export const CLIENT_EXECUTABLES = [
  ...new Set(SPECS.flatMap((s) => s.executables).filter((e) => e.endsWith(".exe"))),
];
