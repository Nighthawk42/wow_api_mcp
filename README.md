# wow-api-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI coding assistants first-class access to the **World of Warcraft addon API** — Blizzard's own generated API documentation, the FrameXML/AddOn UI source code, and the Warcraft Wiki — across **every track** mirrored in [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source), not just the live client.

The API documentation is parsed from `Blizzard_APIDocumentationGenerated` — the machine-readable docs Blizzard ships with the client — so every `C_*` function signature, event payload, enum, and structure is exact, typed, and per-flavor. No scraping involved.

## Flavors

Flavor IDs are exactly the upstream branch names.

| Flavor | Track | Channel |
| --- | --- | --- |
| `live` | Retail | release |
| `ptr` | Retail PTR | ptr |
| `ptr2` | Retail PTR 2 (XPTR) | ptr |
| `beta` | Retail Beta | beta |
| `classic` | Classic, current expansion | release |
| `classic_ptr` | Classic PTR | ptr |
| `classic_beta` | Classic Beta | beta |
| `classic_era` | Classic Era (vanilla) | release |
| `classic_era_ptr` | Classic Era / Anniversary PTR | ptr |
| `classic_anniversary` | Classic Anniversary | release |
| `classic_titan` | Classic Titan | beta |
| `forever` | WoW Forever (1.60) | beta |

The list is not hardcoded: the server offers whatever `data/` contains, and the ingest job discovers upstream branches with `git ls-remote`, so a new Blizzard track becomes available without a code change. Run `list_flavors` for the builds currently shipped.

## Knowing which flavor to use

Signatures differ between retail, Classic, and the test realms, so answering "does this API exist for my addon" means knowing which client the addon targets. The server works that out from your machine:

```
detect_wow_install            → scans for installs, reports each client's build and flavor
resolve_flavor                → build / TOC interface number / product code / path → flavor
check_addon_compatibility     → reads an addon's .toc files and reports the flavor(s) it targets
```

`detect_wow_install` reads, strongest signal first:

1. `.build.info` at the install root — Blizzard product code and exact build per installed product
2. `.flavor.info` inside each `_retail_` / `_classic_` / … directory — the product code
3. the client executable (`Wow.exe`, `WowClassic.exe`, `WowT.exe`, `WowB.exe`, …) — its PE version resource, which is how `_ptr_` and `_xptr_` get identified even though `.build.info` omits them
4. a bundled addon's `## Interface` number

The build number then picks the track, with the product code as a tiebreaker — deliberately in that order, because the two do not line up one-to-one (the Anniversary PTR ships under the `wow_classic_era_ptr` product, and the 1.60 "Forever" client currently occupies the `wow_classic_beta` slot).

Set `WOW_INSTALL_PATH` in the server environment to point at your install; the default flavor for every tool then follows it, preferring a release client over a test realm and retail over Classic when several are installed. `WOW_API_MCP_FLAVOR` pins the default outright, and `WOW_API_MCP_FLAVOR=auto` derives it by probing the usual install locations. Without either variable the default is `live` and startup touches no filesystem beyond `data/`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_flavors` | Flavors with game build, interface version, data commit, API counts |
| `list_systems` | API systems/namespaces per flavor, filterable |
| `search_api` | Fuzzy full-text search over functions, events, enums, structures |
| `get_api` | Full signature detail + cross-flavor availability |
| `diff_api` | Compare one API's existence/signature across flavors |
| `diff_flavors` | Bulk diff: what one flavor has that another lacks |
| `detect_wow_install` | Find installed clients and the flavor each maps to |
| `resolve_flavor` | Build / interface number / product code / path → flavor |
| `check_addon_compatibility` | Read an addon's `.toc` files and resolve its target flavors |
| `search_wiki` | Search warcraft.wiki.gg (guides, TOC format, widget API, …) |
| `get_wiki_page` | Fetch a wiki page as markdown (cached ~24h, CC BY-SA attributed) |
| `search_source` | Regex search over Blizzard's actual UI source per flavor |
| `list_source_files` | List UI source files matching a path glob |
| `get_source_file` | Read UI source files with line numbers / list directories |

## Install

Requires Node 20+. The server is published as [`@nighthawk42/wow-api-mcp`](https://www.npmjs.com/package/@nighthawk42/wow-api-mcp).

**Claude Code**

```bash
claude mcp add wow-api -- npx -y @nighthawk42/wow-api-mcp
```

**Claude Desktop / Cursor / any MCP client** (`mcpServers` JSON):

```json
{
  "mcpServers": {
    "wow-api": {
      "command": "npx",
      "args": ["-y", "@nighthawk42/wow-api-mcp"],
      "env": {
        "WOW_INSTALL_PATH": "D:/Games/World of Warcraft"
      }
    }
  }
}
```

`WOW_INSTALL_PATH` is optional. Without it, `detect_wow_install` still probes the usual install locations on demand; setting it just makes the default flavor follow that install without a scan.

**From source**

```bash
git clone https://github.com/Nighthawk42/wow_api_mcp
cd wow_api_mcp
npm ci && npm run build
claude mcp add wow-api -- node /path/to/wow_api_mcp/dist/index.js
```

On Windows, `npm run update` pulls, rebuilds, and re-registers the server across the local agent configs (see `update.ps1`).

### Environment variables

| Variable | Effect |
| --- | --- |
| `WOW_INSTALL_PATH` | Install path(s) to probe, `;`/`:`-separated. Also makes the default flavor follow that install |
| `WOW_API_MCP_FLAVOR` | Pin the default flavor, or `auto` to derive it by scanning for installs (default: `live`) |
| `WOW_API_MCP_CACHE_FLAVORS` | How many flavor payloads stay resident in memory (default 4) |
| `WOW_API_MCP_DATA_DIR` | Override the bundled `data/` directory |

Notes:
- All flavor data is bundled and gzipped (~5 MB total); nothing is fetched at startup, and payloads load lazily.
- The first `search_source`/`get_source_file` call per flavor downloads a ~200 MB source checkout into your OS cache dir (one-time, pinned to the same commit the API data was built from).
- Wiki pages are fetched on demand and cached for 24 hours.

## Development

```bash
npm run dev          # run the server from source
npm test             # vitest (offline)
npm run typecheck    # tsc --noEmit
npm run verify-data  # check data/ manifest, name index and payloads agree
npm run smoke        # exercise every tool end-to-end (needs network)

npm run ingest               # regenerate data/ from every upstream track
npm run ingest -- --list     # show which tracks exist upstream
npm run ingest -- live ptr   # refresh a subset
npm run ingest -- --prune    # drop data for branches that vanished upstream
```

## Keeping data fresh

`.github/workflows/refresh-data.yml` runs daily, regenerates every track, builds, tests, and **commits straight to `main`** — there is no pull request to merge by hand. Ingest output is deterministic (upstream commit dates instead of wall clock, fixed gzip settings), so an unchanged upstream produces no commit at all. The commit message lists which tracks moved and to which build.

Requirements and options:

- The default `GITHUB_TOKEN` needs push access to `main`. The workflow requests `contents: write` explicitly, which is enough even when the repository's default workflow permission is read-only. If `main` is protected, allow the `github-actions[bot]` actor to bypass the rule.
- `workflow_dispatch` takes an optional list of tracks and a prune toggle for a manual run.

## Releasing

`.github/workflows/release.yml` publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements). It runs the full gate first — build, typecheck, tests, `verify-data` — then publishes, tags, and pushes.

- **By hand:** run the *Release* workflow. `bump` accepts `auto` (default), `patch`, `minor`, `major`, or `none`. `auto` publishes the version already in `package.json` when the registry doesn't have it yet, and otherwise moves the patch digit along.
- **Automatically:** set the repository variable `AUTO_PUBLISH=true`. The daily refresh then calls the same workflow whenever the data actually changed, so npm tracks upstream without anyone doing anything.

Both paths need an `NPM_TOKEN` secret (an npm **automation** token — a granular token works too, scoped to this package with read/write). Without it the job logs a warning and stops instead of failing.

## Data sources & attribution

- API documentation and UI source are © Blizzard Entertainment, mirrored by [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source). The `data/` files in this repo are machine-derived transformations of Blizzard's generated documentation, provided for interoperability.
- Wiki content is fetched live from [warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); responses include attribution.

## License

MIT (server code). See [LICENSE](LICENSE).
