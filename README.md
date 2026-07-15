# wow-api-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI coding assistants first-class access to the **World of Warcraft addon API** — Blizzard's own generated API documentation, the FrameXML/AddOn UI source code, and the Warcraft Wiki — across all four client flavors:

| Flavor ID | Game | Source branch |
| --- | --- | --- |
| `live` | Retail | [Gethe/wow-ui-source@live](https://github.com/Gethe/wow-ui-source/tree/live) |
| `classic` | Classic (current expansion) | [classic](https://github.com/Gethe/wow-ui-source/tree/classic) |
| `classic_era` | Classic Era (vanilla) | [classic_era](https://github.com/Gethe/wow-ui-source/tree/classic_era) |
| `classic_anniversary` | Classic Anniversary | [classic_anniversary](https://github.com/Gethe/wow-ui-source/tree/classic_anniversary) |

## Status

🚧 Under construction — milestone 1 (scaffold) of 6.

## Tools (planned v1 surface)

- `list_flavors` — flavors, interface versions, source commits
- `list_systems` — API systems/namespaces per flavor
- `search_api` — fuzzy search over functions, events, enums, structures
- `get_api` — full signature detail with cross-flavor availability
- `diff_api` — compare an API across all four flavors
- `search_wiki` / `get_wiki_page` — Warcraft Wiki search and page fetch (live, cached)
- `search_source` / `get_source_file` — regex search and file reading over Blizzard's UI source

## Data sources & attribution

- API documentation and UI source are © Blizzard Entertainment, mirrored by [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source). The `data/` files in this repo are machine-derived transformations of Blizzard's generated documentation, provided for interoperability.
- Wiki content is fetched live from [warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); responses include attribution.

## License

MIT (server code). See [LICENSE](LICENSE).
