/**
 * Client for the warcraft.wiki.gg MediaWiki action API with a small disk
 * cache. Page HTML is converted to markdown via turndown (+ GFM tables).
 *
 * Wiki content is CC BY-SA 4.0; every page response carries attribution.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import envPaths from "env-paths";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export const WIKI_BASE = "https://warcraft.wiki.gg";
const API_URL = `${WIKI_BASE}/api.php`;
const USER_AGENT = "wow-api-mcp/0.1.0 (https://github.com/Nighthawk42/wow_api_mcp)";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface WikiSearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface WikiPage {
  title: string;
  url: string;
  markdown: string;
  truncated: boolean;
}

export interface WikiClientOptions {
  cacheDir?: string;
  ttlMs?: number;
  fetchFn?: typeof fetch;
}

export class WikiClient {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly turndown: TurndownService;

  constructor(options: WikiClientOptions = {}) {
    this.cacheDir = options.cacheDir ?? path.join(envPaths("wow-api-mcp", { suffix: "" }).cache, "wiki");
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchFn = options.fetchFn ?? fetch;
    this.turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    gfm(this.turndown);
    this.turndown.remove(["script", "style"]);
    // Drop MediaWiki chrome: navigation boxes, infobox sidebars, TOC, category
    // links, mobile-only helpers, and right-floated nav menus.
    this.turndown.remove((node) => {
      const attr = (name: string) =>
        typeof node.getAttribute === "function" ? (node.getAttribute(name) ?? "") : "";
      if (/\b(navbox|infobox|toc|catlinks|mw-editsection|printfooter|noprint|mobileonly|noexcerpt)\b/.test(attr("class"))) {
        return true;
      }
      return node.nodeName === "DIV" && /float:\s*right/i.test(attr("style"));
    });
  }

  private cachePath(key: string): string {
    return path.join(this.cacheDir, `${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  }

  /** Fetch a MediaWiki API URL as JSON, with disk caching. */
  private async apiRequest(params: Record<string, string>): Promise<any> {
    const url = `${API_URL}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
    const file = this.cachePath(url);
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8")) as { fetchedAt: number; body: unknown };
      if (Date.now() - cached.fetchedAt < this.ttlMs) return cached.body;
    } catch {
      // Missing or unreadable cache entry — fetch fresh.
    }
    const response = await this.fetchFn(url, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Wiki request failed: HTTP ${response.status} for ${url}`);
    const body = await response.json();
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), body }));
    return body;
  }

  pageUrl(title: string): string {
    return `${WIKI_BASE}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  }

  async search(query: string, limit: number): Promise<WikiSearchResult[]> {
    const body = await this.apiRequest({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: String(limit),
    });
    const results: Array<{ title: string; snippet: string }> = body?.query?.search ?? [];
    return results.map((r) => ({
      title: r.title,
      snippet: stripHtml(r.snippet),
      url: this.pageUrl(r.title),
    }));
  }

  async getPage(title: string, maxChars = 40_000): Promise<WikiPage> {
    const body = await this.apiRequest({
      action: "parse",
      page: title,
      prop: "text",
      redirects: "1",
      disableeditsection: "1",
    });
    if (body?.error) {
      throw new Error(`Wiki error for "${title}": ${body.error.info ?? body.error.code}`);
    }
    const resolvedTitle: string = body?.parse?.title ?? title;
    const html: string = body?.parse?.text ?? "";
    let markdown = this.turndown
      .turndown(html)
      .replace(/\]\(\/(wiki\/)/g, `](${WIKI_BASE}/$1`)
      .trim();
    let truncated = false;
    if (markdown.length > maxChars) {
      markdown = `${markdown.slice(0, maxChars)}\n\n… [truncated — fetch again with a larger maxChars for more]`;
      truncated = true;
    }
    return { title: resolvedTitle, url: this.pageUrl(resolvedTitle), markdown, truncated };
  }
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export function attribution(url: string): string {
  return `Source: ${url} — content from warcraft.wiki.gg, licensed CC BY-SA 4.0.`;
}
