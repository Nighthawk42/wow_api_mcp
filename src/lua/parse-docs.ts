/**
 * Converts Blizzard_APIDocumentationGenerated Lua files to plain JS objects.
 *
 * The files are data-only: one or more `local X = { ... }` table constructors
 * followed by `APIDocumentation:AddDocumentationTable(X)`. We parse with
 * luaparse and walk the AST — the Lua is never executed.
 */
import luaparse from "luaparse";

type LuaNode = { type: string; [key: string]: any };

export function parseDocumentationFile(source: string): Record<string, unknown>[] {
  const ast = luaparse.parse(source, { comments: false, luaVersion: "5.1" }) as unknown as LuaNode;
  const localTables = new Map<string, LuaNode>();
  const docTables: Record<string, unknown>[] = [];

  for (const stmt of ast.body as LuaNode[]) {
    if (stmt.type === "LocalStatement") {
      const vars: LuaNode[] = stmt.variables;
      const inits: LuaNode[] = stmt.init ?? [];
      vars.forEach((v, i) => {
        const init = inits[i];
        if (v.type === "Identifier" && init?.type === "TableConstructorExpression") {
          localTables.set(v.name, init);
        }
      });
    } else if (stmt.type === "CallStatement") {
      const expr = stmt.expression;
      if (
        expr?.type === "CallExpression" &&
        expr.base?.type === "MemberExpression" &&
        expr.base.identifier?.name === "AddDocumentationTable" &&
        expr.arguments?.length === 1
      ) {
        const arg = expr.arguments[0];
        const tableNode =
          arg.type === "Identifier"
            ? localTables.get(arg.name)
            : arg.type === "TableConstructorExpression"
              ? arg
              : undefined;
        if (tableNode) {
          docTables.push(luaValueToJs(tableNode) as Record<string, unknown>);
        }
      }
    }
  }
  return docTables;
}

export function luaValueToJs(node: LuaNode): unknown {
  switch (node.type) {
    case "StringLiteral":
      return unescapeLuaString(node.raw);
    case "NumericLiteral":
      return node.value;
    case "BooleanLiteral":
      return node.value;
    case "NilLiteral":
      return null;
    case "UnaryExpression": {
      if (node.operator === "-") {
        const value = luaValueToJs(node.argument);
        if (typeof value === "number") return -value;
      }
      throw new Error(`Unsupported unary expression: ${node.operator}`);
    }
    case "TableConstructorExpression":
      return tableToJs(node);
    // References like `Enum.SecretAspect.Text` or `Constants.TalentConsts.X`
    // are kept as their dotted-name strings.
    case "Identifier":
      return node.name as string;
    case "MemberExpression":
      return `${luaValueToJs(node.base)}${node.indexer}${node.identifier.name}`;
    // Computed constants like `Enum.Flags.A + Enum.Flags.B` become expression strings.
    case "BinaryExpression":
      return `${luaValueToJs(node.left)} ${node.operator} ${luaValueToJs(node.right)}`;
    default:
      throw new Error(`Unsupported Lua value node: ${node.type}`);
  }
}

function tableToJs(node: LuaNode): unknown {
  const items: unknown[] = [];
  const record: Record<string, unknown> = {};
  let hasNamedKeys = false;

  for (const field of node.fields as LuaNode[]) {
    if (field.type === "TableValue") {
      items.push(luaValueToJs(field.value));
    } else if (field.type === "TableKeyString") {
      record[field.key.name] = luaValueToJs(field.value);
      hasNamedKeys = true;
    } else if (field.type === "TableKey") {
      record[String(luaValueToJs(field.key))] = luaValueToJs(field.value);
      hasNamedKeys = true;
    }
  }

  if (hasNamedKeys && items.length > 0) {
    // Mixed tables don't occur in generated docs; fail loudly if that changes.
    throw new Error("Mixed array/record Lua table encountered");
  }
  if (hasNamedKeys) return record;
  // Ambiguous empty table: an empty list is the only meaning used in these files.
  return items;
}

const LUA_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "\n": "\n",
};

export function unescapeLuaString(raw: string): string {
  if (raw.startsWith("[")) {
    // Long bracket string [[...]] / [=[...]=] — no escape processing.
    const match = /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(raw);
    if (!match) throw new Error(`Malformed long string: ${raw.slice(0, 40)}`);
    return match[2]!;
  }
  const body = raw.slice(1, -1);
  return body.replace(/\\(\d{1,3}|x[0-9a-fA-F]{2}|.)/g, (_, esc: string) => {
    if (/^\d/.test(esc)) return String.fromCharCode(parseInt(esc, 10));
    if (esc.startsWith("x")) return String.fromCharCode(parseInt(esc.slice(1), 16));
    const mapped = LUA_ESCAPES[esc];
    if (mapped === undefined) throw new Error(`Unknown Lua escape: \\${esc}`);
    return mapped;
  });
}
