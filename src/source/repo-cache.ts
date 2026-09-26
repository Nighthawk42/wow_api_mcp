/**
 * Manages full shallow checkouts of wow-ui-source branches for source-code
 * search. Each flavor gets one checkout in the OS cache dir, fetched at the
 * exact commit the served API data was generated from, so search results
 * always match the documentation. The first fetch per flavor downloads
 * ~100-200 MB and can take a minute.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
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

interface Checkout {
  dir: string;
  commit: string;
}

const MAX_GREP_BUFFER = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);

/**
 * Runs git without blocking the event loop. The first fetch per flavor takes
 * about a minute; doing it synchronously would freeze the stdio transport, so
 * every other request (and the client's pings) would stall behind it.
 */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GREP_BUFFER,
    windowsHide: true,
  });
  return stdout.trim();
}

/** Exit status of a failed git call (promisified execFile puts it in `code`). */
function exitCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "number" ? code : undefined;
}

/** The most useful line of a failed git call: the end of stderr, else the message. */
function lastLine(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | undefined)?.stderr;
  const message =
    (typeof stderr === "string" && stderr.trim()) || (error instanceof Error ? error.message.trim() : String(error));
  return message.split("\n").at(-1) ?? message;
}

/** True when `child` is `parent` or lives inside it (no prefix-string false positives). */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class SourceRepoCache {
  /** Checkouts known to be at a given commit. */
  private readonly ready = new Map<Flavor, Checkout>();
  /** One in-flight preparation per flavor: concurrent tool calls must not race git. */
  private readonly inflight = new Map<Flavor, Promise<Checkout>>();

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
  async ensure(flavor: Flavor, expectedCommit?: string): Promise<Checkout> {
    const matches = (c: Checkout) => !expectedCommit || c.commit === expectedCommit;
    const ready = this.ready.get(flavor);
    if (ready && matches(ready)) return ready;

    const running = this.inflight.get(flavor);
    if (running) {
      const result = await running;
      return matches(result) ? result : this.ensure(flavor, expectedCommit);
    }

    const job = this.prepare(flavor, expectedCommit).finally(() => this.inflight.delete(flavor));
    this.inflight.set(flavor, job);
    return job;
  }

  private async prepare(flavor: Flavor, expectedCommit?: string): Promise<Checkout> {
    const dir = this.dir(flavor);
    if (!fs.existsSync(path.join(dir, ".git"))) {
      fs.mkdirSync(dir, { recursive: true });
      await git(dir, "init");
      await git(dir, "remote", "add", "origin", UPSTREAM_REPO);
      // Some Blizzard UI paths exceed MAX_PATH once the cache prefix is added.
      if (process.platform === "win32") await git(dir, "config", "core.longpaths", "true");
    }
    let head: string | undefined;
    try {
      head = await git(dir, "rev-parse", "HEAD");
    } catch {
      head = undefined;
    }
    if (expectedCommit && head !== expectedCommit) {
      try {
        await git(dir, "fetch", "--depth", "1", "origin", expectedCommit);
      } catch (error) {
        throw new Error(
          `Could not fetch ${flavor} source at ${expectedCommit.slice(0, 10)} from ${UPSTREAM_REPO}: ${lastLine(error)}`,
        );
      }
      await git(dir, "-c", "advice.detachedHead=false", "checkout", "-f", expectedCommit);
      head = expectedCommit;
    }
    if (!head) {
      throw new Error(`Source checkout for ${flavor} has no commit and no expected commit was provided.`);
    }
    const result = { dir, commit: head };
    this.ready.set(flavor, result);
    return result;
  }

  async search(
    flavor: Flavor,
    pattern: string,
    expectedCommit?: string,
    options: SearchOptions = {},
  ): Promise<SourceHit[]> {
    const { dir } = await this.ensure(flavor, expectedCommit);
    const max = options.maxResults ?? 50;
    const args = ["grep", "-n", "-I", "--no-color", options.fixedString ? "-F" : "-E"];
    if (options.ignoreCase) args.push("-i");
    // Cap matches per file so a very broad pattern cannot blow the stdout buffer.
    args.push("--max-count", String(max + 1));
    args.push("-e", pattern, "--", options.pathGlob ? `:(glob)${options.pathGlob}` : ".");

    let output: string;
    try {
      output = await git(dir, ...args);
    } catch (error) {
      if (exitCode(error) === 1) return []; // git grep exits 1 when nothing matches
      const code = (error as { code?: unknown } | undefined)?.code;
      if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || code === "ENOBUFS") {
        throw new Error(`Pattern /${pattern}/ produced too much output to return. Narrow it, or pass a pathGlob.`);
      }
      throw new Error(`git grep failed for /${pattern}/ in ${flavor}: ${lastLine(error)}`);
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
  async listFiles(flavor: Flavor, glob: string, expectedCommit?: string, limit = 200): Promise<string[]> {
    const { dir } = await this.ensure(flavor, expectedCommit);
    let output: string;
    try {
      output = await git(dir, "ls-files", "--", `:(glob,icase)${glob}`);
    } catch (error) {
      if (exitCode(error) === 1) return [];
      throw error;
    }
    return output.split("\n").filter(Boolean).slice(0, limit);
  }

  async readFile(
    flavor: Flavor,
    filePath: string,
    expectedCommit?: string,
  ): Promise<{ kind: "file"; lines: string[] } | { kind: "directory"; entries: string[] }> {
    const { dir } = await this.ensure(flavor, expectedCommit);
    const root = path.resolve(dir);
    const resolved = path.resolve(root, filePath);
    if (!isInside(root, resolved)) {
      throw new Error("Path escapes the source checkout.");
    }
    const stat = await fs.promises.stat(resolved).catch(() => undefined);
    if (!stat) {
      throw new Error(`No such file in ${flavor} source: ${filePath}`);
    }
    if (stat.isDirectory()) {
      const entries = (await fs.promises.readdir(resolved, { withFileTypes: true }))
        .filter((e) => e.name !== ".git")
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      return { kind: "directory", entries };
    }
    return { kind: "file", lines: (await fs.promises.readFile(resolved, "utf8")).split(/\r?\n/) };
  }
}
