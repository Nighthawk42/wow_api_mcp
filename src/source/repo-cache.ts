/**
 * Manages full shallow checkouts of wow-ui-source branches for source-code
 * search. Each flavor gets one checkout in the OS cache dir, fetched at the
 * exact commit the served API data was generated from, so search results
 * always match the documentation. The first fetch per flavor downloads
 * ~100-200 MB and can take a minute.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import envPaths from "env-paths";
import { UPSTREAM_REPO, type Flavor } from "../types.js";

export interface SourceHit {
  file: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  pathGlob?: string;
  ignoreCase?: boolean;
  fixedString?: boolean;
  maxResults?: number;
}

const MAX_GREP_BUFFER = 64 * 1024 * 1024;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_GREP_BUFFER,
  }).trim();
}

/** True when `child` is `parent` or lives inside it (no prefix-string false positives). */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class SourceRepoCache {
  /** One in-flight `ensure` per flavor: concurrent tool calls must not race git. */
  private readonly pending = new Map<Flavor, { dir: string; commit: string }>();

  constructor(
    private readonly baseDir: string = path.join(envPaths("wow-api-mcp", { suffix: "" }).cache, "source"),
  ) {}

  dir(flavor: Flavor): string {
    return path.join(this.baseDir, flavor);
  }

  /**
   * Ensures a checkout for the flavor exists. When expectedCommit is given
   * and differs from the current HEAD, fetches exactly that commit.
   */
  ensure(flavor: Flavor, expectedCommit?: string): { dir: string; commit: string } {
    const ready = this.pending.get(flavor);
    if (ready && (!expectedCommit || ready.commit === expectedCommit)) return ready;

    const dir = this.dir(flavor);
    if (!fs.existsSync(path.join(dir, ".git"))) {
      fs.mkdirSync(dir, { recursive: true });
      git(dir, "init");
      git(dir, "remote", "add", "origin", UPSTREAM_REPO);
      // Some Blizzard UI paths exceed MAX_PATH once the cache prefix is added.
      if (process.platform === "win32") git(dir, "config", "core.longpaths", "true");
    }
    let head: string | undefined;
    try {
      head = git(dir, "rev-parse", "HEAD");
    } catch {
      head = undefined;
    }
    if (expectedCommit && head !== expectedCommit) {
      try {
        git(dir, "fetch", "--depth", "1", "origin", expectedCommit);
      } catch (error) {
        throw new Error(
          `Could not fetch ${flavor} source at ${expectedCommit.slice(0, 10)} from ${UPSTREAM_REPO}: ` +
            `${error instanceof Error ? error.message.trim().split("\n").at(-1) : String(error)}`,
        );
      }
      git(dir, "-c", "advice.detachedHead=false", "checkout", "-f", expectedCommit);
      head = expectedCommit;
    }
    if (!head) {
      throw new Error(`Source checkout for ${flavor} has no commit and no expected commit was provided.`);
    }
    const result = { dir, commit: head };
    this.pending.set(flavor, result);
    return result;
  }

  search(flavor: Flavor, pattern: string, expectedCommit?: string, options: SearchOptions = {}): SourceHit[] {
    const { dir } = this.ensure(flavor, expectedCommit);
    const max = options.maxResults ?? 50;
    const args = ["grep", "-n", "-I", "--no-color", options.fixedString ? "-F" : "-E"];
    if (options.ignoreCase) args.push("-i");
    // Cap matches per file so a very broad pattern cannot blow the stdout buffer.
    args.push("--max-count", String(max + 1));
    args.push("-e", pattern, "--", options.pathGlob ? `:(glob)${options.pathGlob}` : ".");

    let output: string;
    try {
      output = git(dir, ...args);
    } catch (error: any) {
      if (error?.status === 1) return []; // git grep exits 1 when nothing matches
      if (error?.code === "ENOBUFS") {
        throw new Error(
          `Pattern /${pattern}/ produced too much output to return. Narrow it, or pass a pathGlob.`,
        );
      }
      const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
      throw new Error(`git grep failed for /${pattern}/ in ${flavor}: ${stderr || error?.message || error}`);
    }

    const hits: SourceHit[] = [];
    for (const line of output.split("\n")) {
      if (hits.length > max) break; // keep one extra so callers can detect truncation
      const match = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (match) hits.push({ file: match[1]!, line: Number(match[2]), text: match[3]! });
    }
    return hits;
  }

  /** Repo-relative paths whose name matches a glob, e.g. `**\/*ActionBar*.lua`. */
  listFiles(flavor: Flavor, glob: string, expectedCommit?: string, limit = 200): string[] {
    const { dir } = this.ensure(flavor, expectedCommit);
    let output: string;
    try {
      output = git(dir, "ls-files", "--", `:(glob,icase)${glob}`);
    } catch (error: any) {
      if (error?.status === 1) return [];
      throw error;
    }
    return output.split("\n").filter(Boolean).slice(0, limit);
  }

  readFile(
    flavor: Flavor,
    filePath: string,
    expectedCommit?: string,
  ): { kind: "file"; lines: string[] } | { kind: "directory"; entries: string[] } {
    const { dir } = this.ensure(flavor, expectedCommit);
    const root = path.resolve(dir);
    const resolved = path.resolve(root, filePath);
    if (!isInside(root, resolved)) {
      throw new Error("Path escapes the source checkout.");
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`No such file in ${flavor} source: ${filePath}`);
    }
    if (fs.statSync(resolved).isDirectory()) {
      const entries = fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter((e) => e.name !== ".git")
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      return { kind: "directory", entries };
    }
    return { kind: "file", lines: fs.readFileSync(resolved, "utf8").split(/\r?\n/) };
  }
}
