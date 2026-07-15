import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseDocumentationFile, unescapeLuaString } from "../src/lua/parse-docs.js";
import { emptyNormalizedDocs, normalizeDocTables } from "../src/lua/normalize.js";

const fixture = fs.readFileSync(path.resolve(import.meta.dirname, "fixtures", "sample-doc.lua"), "utf8");

describe("parseDocumentationFile", () => {
  const [doc] = parseDocumentationFile(fixture);

  it("extracts the documentation table registered via AddDocumentationTable", () => {
    expect(doc).toBeDefined();
    expect(doc!.Name).toBe("SampleSystem");
    expect(doc!.Namespace).toBe("C_Sample");
  });

  it("parses functions with typed arguments and returns", () => {
    const functions = doc!.Functions as any[];
    expect(functions).toHaveLength(2);
    const getThing = functions[0];
    expect(getThing.Name).toBe("GetThing");
    expect(getThing.SecretArguments).toBe("AllowedWhenUntainted");
    expect(getThing.Documentation).toEqual(["Returns a thing.", "Second line."]);
    expect(getThing.Arguments[0]).toEqual({ Name: "thingID", Type: "number", Nilable: false });
    expect(getThing.Arguments[1].Default).toBe(" \\r\\n\\t");
    expect(getThing.Returns[1].Default).toBe(-1);
  });

  it("renders enum references and computed constants as strings", () => {
    const functions = doc!.Functions as any[];
    expect(functions[1].SecretReturnsForAspect).toEqual(["Enum.SecretAspect.Text"]);
    const tables = doc!.Tables as any[];
    const constants = tables.find((t) => t.Type === "Constants");
    expect(constants.Values[1].Value).toBe("Enum.ThingFlags.A + Enum.ThingFlags.B");
  });

  it("parses events and enum tables", () => {
    const events = doc!.Events as any[];
    expect(events[0].LiteralName).toBe("THING_CHANGED");
    expect(events[0].Payload[0].Name).toBe("thingID");
    const tables = doc!.Tables as any[];
    expect(tables[0].Fields.map((f: any) => f.EnumValue)).toEqual([0, 1]);
  });
});

describe("normalizeDocTables", () => {
  const docs = emptyNormalizedDocs();
  normalizeDocTables(parseDocumentationFile(fixture), "SampleSystemDocumentation.lua", docs);

  it("records system info with counts", () => {
    expect(docs.systems).toHaveLength(1);
    expect(docs.systems[0]).toMatchObject({
      Name: "SampleSystem",
      Namespace: "C_Sample",
      FunctionCount: 2,
      EventCount: 1,
      TableCount: 3,
    });
  });

  it("qualifies function names with the namespace", () => {
    expect(docs.functions.map((f) => f.QualifiedName)).toEqual(["C_Sample.GetThing", "C_Sample.IsSecret"]);
    expect(docs.functions[0]!.System).toBe("SampleSystem");
  });

  it("uses the literal event name as the qualified name", () => {
    expect(docs.events[0]!.QualifiedName).toBe("THING_CHANGED");
  });

  it("qualifies tables by kind", () => {
    expect(docs.tables.map((t) => t.QualifiedName).sort()).toEqual([
      "Constants.ThingConstants",
      "Enum.ThingKind",
      "ThingInfo",
    ]);
  });
});

describe("unescapeLuaString", () => {
  it("handles quoted strings with escapes", () => {
    expect(unescapeLuaString(String.raw`"a\nb\t\"c\"\\"`)).toBe('a\nb\t"c"\\');
    expect(unescapeLuaString(String.raw`'x\65y'`)).toBe("xAy");
  });

  it("handles long bracket strings", () => {
    expect(unescapeLuaString("[[raw \\n text]]")).toBe("raw \\n text");
  });
});
