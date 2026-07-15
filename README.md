# wow-api-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI coding assistants first-class access to the **World of Warcraft addon API** — Blizzard's own generated API documentation, the FrameXML/AddOn UI source code, and the Warcraft Wiki — across all four client flavors:

| Flavor ID | Game | Source branch |
| --- | --- | --- |
| `live` | Retail | [Gethe/wow-ui-source@live](https://github.com/Gethe/wow-ui-source/tree/live) |
| `classic` | Classic (current expansion) | [classic](https://github.com/Gethe/wow-ui-source/tree/classic) |
| `classic_era` | Classic Era (vanilla) | [classic_era](https://github.com/Gethe/wow-ui-source/tree/classic_era) |
| `classic_anniversary` | Classic Anniversary | [classic_anniversary](https://github.com/Gethe/wow-ui-source/tree/classic_anniversary) |

The API documentation is parsed from `Blizzard_APIDocumentationGenerated` — the machine-readable docs Blizzard ships with the client — so every `C_*` function signature, event payload, enum, and structure is exact, typed, and per-flavor. No scraping involved.

## Tools

| Tool | What it does |
| --- | --- |
| `list_flavors` | Flavors with game build, interface version, data commit, API counts |
| `list_systems` | API systems/namespaces per flavor, filterable |
| `search_api` | Fuzzy full-text search over functions, events, enums, structures |
| `get_api` | Full signature detail + cross-flavor availability |
| `diff_api` | Compare an API's existence/signature across all four flavors |
| `search_wiki` | Search warcraft.wiki.gg (guides, TOC format, widget API, ...) |
| `get_wiki_page` | Fetch a wiki page as markdown (cached ~24h, CC BY-SA attributed) |
| `search_source` | Regex search over Blizzard's actual UI source per flavor |
| `get_source_file` | Read UI source files with line numbers / list directories |

## Install

Requires Node 20+.

```bash
git clone https://github.com/Nighthawk42/wow_api_mcp
cd wow_api_mcp
npm ci && npm run build
```

**Claude Code**

```bash
claude mcp add wow-api -- node /path/to/wow_api_mcp/dist/index.js
```

**Claude Desktop / Cursor / any MCP client** (`mcpServers` JSON):

```json
{
  "mcpServers": {
    "wow-api": {
      "command": "node",
      "args": ["/path/to/wow_api_mcp/dist/index.js"]
    }
  }
}
```

Notes:
- The first `search_source`/`get_source_file` call per flavor downloads a ~200 MB source checkout into your OS cache dir (one-time, pinned to the same commit the API data was built from).
- Wiki pages are fetched on demand and cached for 24 hours.

## Development

```bash
npm run dev     # run the server from source
npm test        # vitest (offline)
npm run smoke   # exercise every tool end-to-end (needs network)
npm run ingest  # regenerate data/*.json from wow-ui-source
```

Data is refreshed weekly by a scheduled GitHub Action that opens a PR when upstream changes. See [AGENTS.md](AGENTS.md) for architecture details.

## Data sources & attribution

- API documentation and UI source are © Blizzard Entertainment, mirrored by [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source). The `data/` files in this repo are machine-derived transformations of Blizzard's generated documentation, provided for interoperability.
- Wiki content is fetched live from [warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); responses include attribution.

## License

MIT (server code). See [LICENSE](LICENSE).
