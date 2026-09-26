/**
 * Turns raw parsed doc tables into the FlavorData shape served by the MCP
 * tools. Blizzard's PascalCase keys are preserved verbatim; normalization only
 * adds computed fields (QualifiedName, System, SourceFile) and flattens the
 * per-system layout into flavor-wide function/event/table lists.
 */
import type { ApiEntry, ApiField, SystemInfo } from "../types.js";

export interface NormalizedDocs {
  systems: SystemInfo[];
  functions: ApiEntry[];
  events: ApiEntry[];
  tables: ApiEntry[];
}

type RawDocTable = Record<string, unknown>;

function asArray(value: unknown): RawDocTable[] {
  return Array.isArray(value) ? (value as RawDocTable[]) : [];
}

/** In-game qualified name for a Tables entry (enum, constants, structure). */
function tableQualifiedName(entry: RawDocTable): string {
  const name = String(entry.Name ?? "");
  switch (entry.Type) {
    case "Enumeration":
      return `Enum.${name}`;
    case "Constants":
      return `Constants.${name}`;
    default:
      return name; // Structures are documentation-only types.
  }
}

export function normalizeDocTables(
  docTables: RawDocTable[],
  sourceFile: string,
  into: NormalizedDocs,
): void {
  for (const doc of docTables) {
    const systemName = String(doc.Name ?? sourceFile.replace(/(API)?Documentation\.lua$/, ""));
    const namespace = typeof doc.Namespace === "string" ? doc.Namespace : undefined;

    const functions = asArray(doc.Functions);
    const events = asArray(doc.Events);
    const tables = asArray(doc.Tables);

    into.systems.push({
      Name: systemName,
      Namespace: namespace,
      Environment: typeof doc.Environment === "string" ? doc.Environment : undefined,
      SourceFile: sourceFile,
      FunctionCount: functions.length,
      EventCount: events.length,
      TableCount: tables.length,
    });

    for (const fn of functions) {
      const name = String(fn.Name ?? "");
      into.functions.push({
        ...(fn as Partial<ApiEntry>),
        QualifiedName: namespace ? `${namespace}.${name}` : name,
        System: systemName,
        Namespace: namespace,
        SourceFile: sourceFile,
      } as ApiEntry);
    }

    for (const event of events) {
      // LiteralName ("PLAYER_ENTERING_WORLD") is what addon code registers for.
      const literal = typeof event.LiteralName === "string" ? event.LiteralName : String(event.Name ?? "");
      into.events.push({
        ...(event as Partial<ApiEntry>),
        QualifiedName: literal,
        System: systemName,
        Namespace: namespace,
        SourceFile: sourceFile,
      } as ApiEntry);
    }

    for (const table of tables) {
      into.tables.push({
        ...(table as Partial<ApiEntry>),
        QualifiedName: tableQualifiedName(table),
        System: systemName,
        Namespace: namespace,
        SourceFile: sourceFile,
      } as ApiEntry);
    }
  }
}

export function emptyNormalizedDocs(): NormalizedDocs {
  return { systems: [], functions: [], events: [], tables: [] };
}

export type { ApiEntry, ApiField };
