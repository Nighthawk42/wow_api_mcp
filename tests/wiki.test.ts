import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WikiClient, stripHtml } from "../src/wiki/client.js";

const searchBody = {
  query: {
    search: [
      { title: "TOC format", snippet: 'The <span class="searchmatch">TOC format</span> describes addons.' },
    ],
  },
};

const parseBody = {
  parse: {
    title: "TOC format",
    text:
      "<h2>Directives</h2><p>A <b>TOC</b> file lists addon metadata.</p>" +
      "<table><tr><th>Tag</th><th>Meaning</th></tr><tr><td>## Interface</td><td>Client build</td></tr></table>" +
      "<script>evil()</script>",
  },
};

function fakeFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

let cacheDir: string;

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "wow-api-mcp-test-"));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe("WikiClient", () => {
  it("parses search results and strips snippet HTML", async () => {
    const client = new WikiClient({ cacheDir, fetchFn: fakeFetch(searchBody) });
    const results = await client.search("toc", 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "TOC format",
      snippet: "The TOC format describes addons.",
      url: "https://warcraft.wiki.gg/wiki/TOC_format",
    });
  });

  it("converts page HTML to markdown with tables, dropping scripts", async () => {
    const client = new WikiClient({ cacheDir, fetchFn: fakeFetch(parseBody) });
    const page = await client.getPage("TOC format");
    expect(page.markdown).toContain("## Directives");
    expect(page.markdown).toContain("**TOC**");
    expect(page.markdown).toContain("| Tag | Meaning |");
    expect(page.markdown).toContain("## Interface");
    expect(page.markdown).not.toContain("evil()");
    expect(page.truncated).toBe(false);
  });

  it("serves repeat requests from the disk cache", async () => {
    const fetchFn = fakeFetch(parseBody);
    const client = new WikiClient({ cacheDir, fetchFn });
    await client.getPage("TOC format");
    await client.getPage("TOC format");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // A fresh client instance reuses the same on-disk cache.
    const fetchFn2 = fakeFetch(parseBody);
    const client2 = new WikiClient({ cacheDir, fetchFn: fetchFn2 });
    await client2.getPage("TOC format");
    expect(fetchFn2).not.toHaveBeenCalled();
  });

  it("refetches when the cache entry is older than the TTL", async () => {
    const fetchFn = fakeFetch(parseBody);
    const client = new WikiClient({ cacheDir, fetchFn, ttlMs: -1 });
    await client.getPage("TOC format");
    await client.getPage("TOC format");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("truncates long pages and flags it", async () => {
    const longBody = { parse: { title: "Long", text: `<p>${"word ".repeat(2000)}</p>` } };
    const client = new WikiClient({ cacheDir, fetchFn: fakeFetch(longBody) });
    const page = await client.getPage("Long", 1000);
    expect(page.truncated).toBe(true);
    expect(page.markdown).toContain("[truncated");
  });

  it("throws a useful error for missing pages", async () => {
    const errorBody = { error: { code: "missingtitle", info: "The page you specified doesn't exist." } };
    const client = new WikiClient({ cacheDir, fetchFn: fakeFetch(errorBody) });
    await expect(client.getPage("No Such Page")).rejects.toThrow(/doesn't exist/);
  });
});

describe("stripHtml", () => {
  it("removes tags", () => {
    expect(stripHtml('a <b>bold</b> <span class="x">move</span>')).toBe("a bold move");
  });
});
