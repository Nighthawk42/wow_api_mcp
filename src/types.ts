/**
 * Flavor IDs are upstream branch names, discovered at runtime from `data/`
 * rather than hardcoded, so a newly ingested track works without a code change.
 * See `src/flavors.ts` for presentation metadata and `src/data/manifest.ts`
 * for the list actually available.
 */
export type Flavor = string;

export const UPSTREAM_REPO = "https://github.com/Gethe/wow-ui-source";
export const DOCS_PATH = "Interface/AddOns/Blizzard_APIDocumentationGenerated";

/**
 * Field/parameter entries keep Blizzard's original PascalCase keys verbatim
 * (Name, Type, Nilable, InnerType, Mixin, Default, EnumValue, Value, ...).
 */
export interface ApiField {
  Name?: string;
  Type?: string;
  Nilable?: boolean;
  InnerType?: string;
  Mixin?: string;
  Default?: unknown;
  EnumValue?: number;
  Value?: unknown;
  Documentation?: string[];
  [key: string]: unknown;
}

/** A function, event, or table (enum/structure/constants) entry. */
export interface ApiEntry {
  Name?: string;
  Type?: string;
  LiteralName?: string;
  Documentation?: string[];
  SecretArguments?: string;
  Arguments?: ApiField[];
  Returns?: ApiField[];
  Payload?: ApiField[];
  Fields?: ApiField[];
  Values?: ApiField[];
  [key: string]: unknown;
  /** Added during normalization: */
  QualifiedName: string;
  System: string;
  Namespace?: string;
  SourceFile: string;
}

export interface SystemInfo {
  Name: string;
  Namespace?: string;
  Environment?: string;
  SourceFile: string;
  FunctionCount: number;
  EventCount: number;
  TableCount: number;
}

export interface FlavorMeta {
  flavor: Flavor;
  branch: string;
  commit: string;
  /** Game build from version.txt, e.g. "12.1.0.69875" */
  version: string;
  /** Derived interface number, e.g. 120100 */
  interfaceVersion: number;
  generatedAt: string;
}

export interface FlavorData {
  meta: FlavorMeta;
  systems: SystemInfo[];
  functions: ApiEntry[];
  events: ApiEntry[];
  tables: ApiEntry[];
}

export interface FlavorCounts {
  systems: number;
  functions: number;
  events: number;
  tables: number;
}

export interface FlavorManifestEntry extends FlavorMeta {
  counts: FlavorCounts;
}

export interface DataManifest {
  /** Bumped when the on-disk data layout changes incompatibly. */
  formatVersion: number;
  generatedAt: string;
  flavors: FlavorManifestEntry[];
}

/** Parses "12.1.0.69875" into its four numeric components (missing parts are 0). */
export function parseBuild(version: string): [number, number, number, number] {
  const parts = version
    .trim()
    .split(".")
    .map((p) => Number.parseInt(p, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

/** TOC `## Interface` number for a build string, e.g. "12.1.0.69875" → 120100. */
export function interfaceVersionFromBuild(version: string): number {
  const [major, minor, patch] = parseBuild(version);
  return major * 10000 + minor * 100 + patch;
}
