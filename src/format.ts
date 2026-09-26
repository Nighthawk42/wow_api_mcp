/** Markdown rendering for API entries. */
import type { ApiEntry, ApiField } from "./types.js";
import type { EntryKind, IndexedEntry } from "./data/loader.js";

export function typeString(field: ApiField): string {
  let type = field.Type ?? "unknown";
  if (type === "table" && field.InnerType) type = `table<${field.InnerType}>`;
  if (field.Mixin) type += ` (mixin: ${field.Mixin})`;
  return type;
}

function fieldLine(field: ApiField, options: { enumValues?: boolean } = {}): string {
  if (options.enumValues && field.EnumValue !== undefined) {
    return `- \`${field.Name}\` = ${field.EnumValue}`;
  }
  if (field.Value !== undefined) {
    return `- \`${field.Name}\` (${typeString(field)}) = ${JSON.stringify(field.Value)}`;
  }
  let line = `- \`${field.Name}\` ${typeString(field)}${field.Nilable ? "?" : ""}`;
  if (field.Default !== undefined) line += ` — default: ${JSON.stringify(field.Default)}`;
  if (Array.isArray(field.Documentation) && field.Documentation.length > 0) {
    line += ` — ${field.Documentation.join(" ")}`;
  }
  return line;
}

function fieldSection(title: string, fields: ApiField[] | undefined, options?: { enumValues?: boolean }): string[] {
  if (!Array.isArray(fields) || fields.length === 0) return [];
  return [`**${title}**`, ...fields.map((f) => fieldLine(f, options)), ""];
}

export function functionSignature(fn: ApiEntry): string {
  const args = (fn.Arguments ?? [])
    .map((a) => (a.Nilable || a.Default !== undefined ? `[${a.Name}]` : a.Name))
    .join(", ");
  const rets = (fn.Returns ?? []).map((r) => r.Name).join(", ");
  return `${rets ? `${rets} = ` : ""}${fn.QualifiedName}(${args})`;
}

export function oneLiner(indexed: IndexedEntry): string {
  const { kind, entry } = indexed;
  switch (kind) {
    case "function":
      return `function \`${functionSignature(entry)}\` — ${entry.System}`;
    case "event": {
      const payload = (entry.Payload ?? []).map((p) => p.Name).join(", ");
      return `event \`${entry.QualifiedName}\`${payload ? ` (payload: ${payload})` : ""} — ${entry.System}`;
    }
    case "table":
      return `${(entry.Type ?? "table").toLowerCase()} \`${entry.QualifiedName}\` — ${entry.System}`;
  }
}

export function renderEntry(indexed: IndexedEntry): string {
  const { kind, entry } = indexed;
  const lines: string[] = [`### ${entry.QualifiedName}`];

  if (kind === "function") {
    lines.push("```lua", functionSignature(entry), "```");
  } else if (kind === "event") {
    lines.push("```lua", `frame:RegisterEvent("${entry.QualifiedName}")`, "```");
  } else {
    lines.push(`*${entry.Type}*`);
  }

  lines.push(`System: ${entry.System} (\`${entry.SourceFile}\`)`, "");

  if (Array.isArray(entry.Documentation) && entry.Documentation.length > 0) {
    lines.push(...entry.Documentation, "");
  }

  lines.push(...fieldSection("Arguments", entry.Arguments));
  lines.push(...fieldSection("Returns", entry.Returns));
  lines.push(...fieldSection("Payload", entry.Payload));
  if (entry.Type === "Enumeration") {
    lines.push(...fieldSection("Values", entry.Fields, { enumValues: true }));
  } else {
    lines.push(...fieldSection("Fields", entry.Fields));
  }
  lines.push(...fieldSection("Constants", entry.Values));

  const extras: string[] = [];
  if (entry.SecretArguments) extras.push(`SecretArguments: ${entry.SecretArguments}`);
  if (entry.MinValue !== undefined) extras.push(`Range: ${entry.MinValue}–${entry.MaxValue}`);
  if (extras.length > 0) lines.push(extras.join(" · "), "");

  return lines.join("\n").trimEnd();
}

export const KIND_LABELS: Record<EntryKind, string> = {
  function: "Function",
  event: "Event",
  table: "Table",
};
