import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { readJson, readText, writeJson } from "../src/data/paths.js";

const made: string[] = [];
function tmp(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wow-paths-"));
  made.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeJson", () => {
  it("round-trips gzipped payloads", () => {
    const file = tmp("x.json.gz");
    expect(writeJson(file, { a: 1 })).toBe(true);
    expect(readJson<{ a: number }>(file)).toEqual({ a: 1 });
  });

  it("pretty-prints plain .json and minifies .gz", () => {
    const plain = tmp("m.json");
    const gz = tmp("m.json.gz");
    writeJson(plain, { a: 1 });
    writeJson(gz, { a: 1 });
    expect(fs.readFileSync(plain, "utf8")).toBe('{\n  "a": 1\n}\n');
    expect(readText(gz)).toBe('{"a":1}\n');
  });

  it("reports no change and leaves bytes alone when content is identical", () => {
    const file = tmp("x.json.gz");
    writeJson(file, { a: 1 });
    const before = fs.readFileSync(file);
    expect(writeJson(file, { a: 1 })).toBe(false);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it("rewrites when the content actually changes", () => {
    const file = tmp("x.json.gz");
    writeJson(file, { a: 1 });
    expect(writeJson(file, { a: 2 })).toBe(true);
    expect(readJson<{ a: number }>(file)).toEqual({ a: 2 });
  });

  it("leaves a file written by a different zlib build untouched when content matches", () => {
    // The real failure mode: another machine's gzip encodes the same JSON into
    // different bytes. Content is what decides, so this must not rewrite.
    const file = tmp("x.json.gz");
    const text = JSON.stringify({ a: 1 }) + "\n";
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(text, "utf8"), { level: 1 })); // different level => different bytes
    const foreign = fs.readFileSync(file);
    expect(writeJson(file, { a: 1 })).toBe(false);
    expect(fs.readFileSync(file).equals(foreign)).toBe(true);
  });
});
