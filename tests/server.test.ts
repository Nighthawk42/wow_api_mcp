import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

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

describe("API doc tools", () => {
  it("lists the expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "diff_api",
      "get_api",
      "get_wiki_page",
      "list_flavors",
      "list_systems",
      "search_api",
      "search_wiki",
    ]);
  });

  it("list_flavors reports all four flavors with builds", async () => {
    const text = toolText(await client.callTool({ name: "list_flavors", arguments: {} }));
    for (const flavor of ["live", "classic", "classic_era", "classic_anniversary"]) {
      expect(text).toContain(`| ${flavor} |`);
    }
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

  it("get_api returns full function documentation with availability", async () => {
    const text = toolText(
      await client.callTool({ name: "get_api", arguments: { name: "C_Timer.After", flavor: "live" } }),
    );
    expect(text).toContain("### C_Timer.After");
    expect(text).toContain("**Arguments**");
    expect(text).toContain("Availability:");
    expect(text).toContain("live ✓");
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
});
