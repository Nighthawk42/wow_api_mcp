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
  it("greps with regex and reports file:line hits", async () => {
    const hits = await cache.search("live", "RegisterEvent\\(", undefined);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: "Interface/AddOns/Blizzard_Demo/Demo.lua", line: 2 });
    expect(hits[0]!.text).toContain("PLAYER_ENTERING_WORLD");
  });

  it("supports case-insensitive search and path globs", async () => {
    expect(await cache.search("live", "secureactionbutton", undefined)).toHaveLength(0);
    expect(await cache.search("live", "secureactionbutton", undefined, { ignoreCase: true })).toHaveLength(1);
    const luaOnly = await cache.search("live", "Demo", undefined, {
      ignoreCase: true,
      pathGlob: "Interface/**/*.lua",
    });
    expect(luaOnly.every((h) => h.file.endsWith(".lua"))).toBe(true);
  });

  it("returns empty for no matches", async () => {
    expect(await cache.search("live", "NoSuchSymbolAnywhere", undefined)).toEqual([]);
  });

  it("lists files by glob", async () => {
    expect(await cache.listFiles("live", "**/*.xml")).toEqual(["Interface/AddOns/Blizzard_Demo/Demo.xml"]);
    expect(await cache.listFiles("live", "**/*.nope")).toEqual([]);
  });

  it("reads files and lists directories", async () => {
    const file = await cache.readFile("live", "Interface/AddOns/Blizzard_Demo/Demo.lua", undefined);
    expect(file.kind).toBe("file");
    if (file.kind === "file") expect(file.lines[0]).toBe("function Demo_OnLoad(self)");

    const dir = await cache.readFile("live", "Interface/AddOns/Blizzard_Demo", undefined);
    expect(dir.kind).toBe("directory");
    if (dir.kind === "directory") expect(dir.entries).toEqual(["Demo.lua", "Demo.xml"]);
  });

  it("rejects paths escaping the checkout", async () => {
    await expect(cache.readFile("live", "../../etc/passwd", undefined)).rejects.toThrow(/escapes/);
  });

  it("rejects missing files", async () => {
    await expect(cache.readFile("live", "Interface/Nope.lua", undefined)).rejects.toThrow(/No such file/);
  });

  it("serves concurrent calls without blocking the event loop", async () => {
    const fresh = new SourceRepoCache(baseDir);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const [a, b] = await Promise.all([
      fresh.search("live", "Demo_OnLoad", undefined),
      fresh.search("live", "DemoFrame", undefined),
    ]);
    clearInterval(timer);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // With synchronous git the timer could never fire while the calls ran.
    expect(ticks).toBeGreaterThan(0);
  });

  it("reports a clear error when the pinned commit cannot be fetched", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "wow-api-mcp-src-empty-"));
    try {
      // No network is touched: the "origin" remote below points at a missing local path.
      const broken = new SourceRepoCache(empty);
      const dir = broken.dir("live");
      fs.mkdirSync(dir, { recursive: true });
      git(dir, "init");
      git(dir, "remote", "add", "origin", path.join(empty, "no-such-remote"));
      await expect(broken.search("live", "x", "0".repeat(40))).rejects.toThrow(/Could not fetch live source/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
