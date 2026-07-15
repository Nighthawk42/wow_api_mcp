export const FLAVORS = ["live", "classic", "classic_era", "classic_anniversary"] as const;
export type Flavor = (typeof FLAVORS)[number];

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
  /** Game build from version.txt, e.g. "12.0.7.68453" */
  version: string;
  /** Derived interface number, e.g. 120007 */
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
