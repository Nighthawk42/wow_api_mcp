/**
 * Maps a detected client (product code + build number) onto one of the
 * ingested wow-ui-source tracks.
 *
 * Build number is the strong signal and product code only a hint, because the
 * two do not line up one-to-one: the Anniversary PTR ships under the
 * `wow_classic_era_ptr` product, and the 1.60 "Forever" client currently ships
 * in the `wow_classic_beta` slot. Matching on the build first gets both right.
 */
import { flavorSpec } from "../flavors.js";
import { manifest } from "../data/manifest.js";
import { parseBuild } from "../types.js";

export interface ResolveInput {
  /** Blizzard product code, e.g. `wow`, `wowt`, `wow_classic_era`. */
  product?: string;
  /** Build string, e.g. "12.1.0.69814". */
  version?: string;
  /** TOC `## Interface` number, e.g. 120100. */
  interfaceVersion?: number;
  /** Install directory name, e.g. `_retail_`. */
  installDir?: string;
}

export interface FlavorCandidate {
  flavor: string;
  label: string;
  version: string;
  interfaceVersion: number;
  score: number;
  reasons: string[];
}

export interface ResolveResult {
  /** Best candidate, or undefined when nothing scored above zero. */
  best?: FlavorCandidate;
  candidates: FlavorCandidate[];
  /** How trustworthy `best` is. */
  confidence: "exact" | "high" | "medium" | "low" | "none";
}

const SCORE_EXACT_BUILD = 1000;
const SCORE_SAME_PATCH = 500;
const SCORE_SAME_MINOR = 200;
const SCORE_SAME_MAJOR = 50;
const SCORE_PRODUCT = 120;
const SCORE_INSTALL_DIR = 40;
const SCORE_INTERFACE = 260;

export function resolveFlavor(input: ResolveInput): ResolveResult {
  const wanted = input.version ? parseBuild(input.version) : undefined;
  const candidates: FlavorCandidate[] = [];

  for (const entry of manifest().flavors) {
    const spec = flavorSpec(entry.flavor);
    const have = parseBuild(entry.version);
    let score = 0;
    const reasons: string[] = [];

    if (wanted) {
      if (wanted.join(".") === have.join(".")) {
        score += SCORE_EXACT_BUILD;
        reasons.push(`exact build ${entry.version}`);
      } else if (wanted[0] === have[0] && wanted[1] === have[1] && wanted[2] === have[2]) {
        score += SCORE_SAME_PATCH;
        reasons.push(`patch ${have.slice(0, 3).join(".")} matches`);
      } else if (wanted[0] === have[0] && wanted[1] === have[1]) {
        score += SCORE_SAME_MINOR;
        reasons.push(`release ${have.slice(0, 2).join(".")} matches`);
      } else if (wanted[0] === have[0]) {
        score += SCORE_SAME_MAJOR;
        reasons.push(`major version ${have[0]} matches`);
      }
    }

    if (input.interfaceVersion && input.interfaceVersion === entry.interfaceVersion) {
      score += SCORE_INTERFACE;
      reasons.push(`interface ${entry.interfaceVersion} matches`);
    }

    if (input.product && spec.products.includes(input.product)) {
      score += SCORE_PRODUCT;
      reasons.push(`product \`${input.product}\``);
    }

    if (input.installDir && spec.installDirs.includes(input.installDir)) {
      score += SCORE_INSTALL_DIR;
      reasons.push(`install dir \`${input.installDir}\``);
    }

    if (score > 0) {
      candidates.push({
        flavor: entry.flavor,
        label: spec.label,
        version: entry.version,
        interfaceVersion: entry.interfaceVersion,
        score,
        reasons,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.flavor.localeCompare(b.flavor));
  const best = candidates[0];
  let confidence: ResolveResult["confidence"] = "none";
  if (best) {
    if (best.score >= SCORE_EXACT_BUILD) confidence = "exact";
    else if (best.score >= SCORE_SAME_PATCH) confidence = "high";
    else if (best.score >= SCORE_SAME_MINOR) confidence = "medium";
    else confidence = "low";
  }
  return { best, candidates, confidence };
}
