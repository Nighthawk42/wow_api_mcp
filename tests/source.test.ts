import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SourceRepoCache } from "../src/source/repo-cache.js";

let baseDir: string;
let cache: SourceRepoCache;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeAll(() => {
  // Fake a cached "live" checkout: a real git repo with a couple of files.
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "wow-api-mcp-src-"));
  const repo = path.join(baseDir, "live");
  fs.mkdirSync(path.join(repo, "Interface", "AddOns", "Blizzard_Demo"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "Interface", "AddOns", "Blizzard_Demo", "Demo.lua"),
    'function Demo_OnLoad(self)\n\tself:RegisterEvent("PLAYER_ENTERING_WORLD");\nend\n',
  );
  fs.writeFileSync(
    path.join(repo, "Interface", "AddOns", "Blizzard_Demo", "Demo.xml"),
    '<Ui><Frame name="DemoFrame" inherits="SecureActionButtonTemplate"/></Ui>\n',
  );
  git(repo, "init");
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "fixture");
  cache = new SourceRepoCache(baseDir);
});

afterAll(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("SourceRepoCache", () => {
  it("greps with regex and reports file:line hits", () => {
    const hits = cache.search("live", "RegisterEvent\\(", undefined);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: "Interface/AddOns/Blizzard_Demo/Demo.lua", line: 2 });
    expect(hits[0]!.text).toContain("PLAYER_ENTERING_WORLD");
  });

  it("supports case-insensitive search and path globs", () => {
    expect(cache.search("live", "secureactionbutton", undefined)).toHaveLength(0);
    expect(cache.search("live", "secureactionbutton", undefined, { ignoreCase: true })).toHaveLength(1);
    const luaOnly = cache.search("live", "Demo", undefined, {
      ignoreCase: true,
      pathGlob: "Interface/**/*.lua",
    });
    expect(luaOnly.every((h) => h.file.endsWith(".lua"))).toBe(true);
  });

  it("returns empty for no matches", () => {
    expect(cache.search("live", "NoSuchSymbolAnywhere", undefined)).toEqual([]);
  });

  it("reads files and lists directories", () => {
    const file = cache.readFile("live", "Interface/AddOns/Blizzard_Demo/Demo.lua", undefined);
    expect(file.kind).toBe("file");
    if (file.kind === "file") expect(file.lines[0]).toBe("function Demo_OnLoad(self)");

    const dir = cache.readFile("live", "Interface/AddOns/Blizzard_Demo", undefined);
    expect(dir.kind).toBe("directory");
    if (dir.kind === "directory") expect(dir.entries).toEqual(["Demo.lua", "Demo.xml"]);
  });

  it("rejects paths escaping the checkout", () => {
    expect(() => cache.readFile("live", "../../etc/passwd", undefined)).toThrow(/escapes/);
  });

  it("rejects missing files", () => {
    expect(() => cache.readFile("live", "Interface/Nope.lua", undefined)).toThrow(/No such file/);
  });
});
