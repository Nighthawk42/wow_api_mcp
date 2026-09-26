import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { availableFlavors } from "../src/data/manifest.js";

let client: Client;

function toolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? "").join("\n");
}

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

describe("tool registration", () => {
  it("lists the expected tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_addon_compatibility",
      "detect_wow_install",
      "diff_api",
      "diff_flavors",
      "get_api",
      "get_source_file",
      "get_wiki_page",
      "list_flavors",
      "list_source_files",
      "list_systems",
      "resolve_flavor",
      "search_api",
      "search_source",
      "search_wiki",
    ]);
  });

  it("marks every tool read-only, and only the network ones open-world", async () => {
    const { tools } = await client.listTools();
    const network = ["get_source_file", "get_wiki_page", "list_source_files", "search_source", "search_wiki"];
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.annotations?.openWorldHint, tool.name).toBe(network.includes(tool.name));
    }
  });

  it("offers every available flavor in the flavor enum", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "search_api")!.inputSchema as any;
    expect(schema.properties.flavor.enum.sort()).toEqual([...availableFlavors()].sort());
  });
});

describe("API doc tools", () => {
  it("list_flavors reports every ingested track", async () => {
    const text = toolText(await client.callTool({ name: "list_flavors", arguments: {} }));
    for (const flavor of availableFlavors()) {
      expect(text).toContain(`| ${flavor} |`);
    }
    expect(text).toContain("| live |");
    expect(text).toContain("| classic_era |");
  });

  it("list_flavors can restrict to a game line", async () => {
    const text = toolText(await client.callTool({ name: "list_flavors", arguments: { line: "retail" } }));
    expect(text).toContain("| live |");
    expect(text).not.toContain("| classic_era |");
  });

  it("list_systems filters by namespace", async () => {
    const text = toolText(
      await client.callTool({ name: "list_systems", arguments: { flavor: "live", filter: "C_Timer" } }),
    );
    expect(text).toContain("C_Timer");
  });

  it("search_api finds C_Timer.After", async () => {
    const text = toolText(
      await client.callTool({ name: "search_api", arguments: { query: "timer after", flavor: "live" } }),
    );
    expect(text).toContain("C_Timer.After");
  });

  it("search_api can restrict to events", async () => {
    const text = toolText(
      await client.callTool({
        name: "search_api",
        arguments: { query: "unit health", flavor: "live", kind: "event" },
      }),
    );
    expect(text).toContain("UNIT_HEALTH");
    expect(text).not.toContain("function `");
  });

  it("search_api works against a newly added track", async () => {
    const text = toolText(
      await client.callTool({ name: "search_api", arguments: { query: "timer after", flavor: "ptr" } }),
    );
    expect(text).toContain("C_Timer.After");
  });

  it("get_api returns full function documentation with availability", async () => {
    const text = toolText(
      await client.callTool({ name: "get_api", arguments: { name: "C_Timer.After", flavor: "live" } }),
    );
    expect(text).toContain("### C_Timer.After");
    expect(text).toContain("**Arguments**");
    expect(text).toMatch(/Availability: present in \d+\/\d+/);
    expect(text).toContain("live");
  });

  it("get_api resolves event literals case-insensitively", async () => {
    const text = toolText(
      await client.callTool({ name: "get_api", arguments: { name: "player_entering_world", flavor: "live" } }),
    );
    expect(text).toContain("PLAYER_ENTERING_WORLD");
    expect(text).toContain("**Payload**");
  });

  it("get_api suggests close matches for unknown names", async () => {
    const text = toolText(
      await client.callTool({ name: "get_api", arguments: { name: "C_Timer.Aftr", flavor: "live" } }),
    );
    expect(text).toContain("No API named");
    expect(text).toContain("C_Timer.After");
  });

  it("get_api points at other flavors when a retail API is missing", async () => {
    const text = toolText(
      await client.callTool({
        name: "get_api",
        arguments: { name: "C_DelvesUI.GetActiveDelveTier", flavor: "classic_era" },
      }),
    );
    expect(text).toContain("No API named");
    expect(text).toContain("Present in other flavors");
  });

  it("diff_api reports per-flavor availability", async () => {
    const text = toolText(await client.callTool({ name: "diff_api", arguments: { name: "C_Timer.After" } }));
    expect(text).toContain("## live");
    expect(text).toContain("## classic_era");
  });

  it("diff_api shows an API missing from old flavors", async () => {
    // Delves are a retail-only feature; the API must not exist in classic_era.
    const text = toolText(
      await client.callTool({ name: "diff_api", arguments: { name: "C_DelvesUI.GetActiveDelveTier" } }),
    );
    expect(text).toMatch(/## classic_era[^#]*Not present/);
  });

  it("diff_api rejects unknown flavors instead of silently dropping them", async () => {
    const result = await client.callTool({
      name: "diff_api",
      arguments: { name: "C_Timer.After", flavors: ["live", "retail"] },
    });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("Unknown flavor(s): retail");
  });

  it("diff_api can be limited to named flavors", async () => {
    const text = toolText(
      await client.callTool({ name: "diff_api", arguments: { name: "C_Timer.After", flavors: ["live", "ptr"] } }),
    );
    expect(text).toContain("## live");
    expect(text).toContain("## ptr");
    expect(text).not.toContain("## classic_era");
  });

  it("diff_flavors lists APIs retail has that Classic Era lacks", async () => {
    const text = toolText(
      await client.callTool({
        name: "diff_flavors",
        arguments: { from: "classic_era", to: "live", kind: "function", filter: "C_Delves", direction: "added" },
      }),
    );
    expect(text).toContain("Only in live");
    expect(text).toContain("C_DelvesUI");
  });

  it("diff_flavors refuses to diff a flavor against itself", async () => {
    const text = toolText(
      await client.callTool({ name: "diff_flavors", arguments: { from: "live", to: "live" } }),
    );
    expect(text).toContain("same flavor");
  });
});
