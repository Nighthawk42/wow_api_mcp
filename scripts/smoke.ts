/**
 * End-to-end smoke test: spins up the real server over an in-memory
 * transport and calls every tool, printing a condensed result for each.
 * Requires network (wiki + source tools). Usage: npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { availableFlavors } from "../src/data/manifest.js";

function first(text: string, lines = 6): string {
  return text
    .split("\n")
    .slice(0, lines)
    .map((l) => `    ${l}`)
    .join("\n");
}

async function main() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const calls: Array<[string, Record<string, unknown>]> = [
    ["list_flavors", {}],
    ["list_flavors", { line: "classic_era" }],
    ["list_systems", { flavor: "live", filter: "timer" }],
    ["search_api", { query: "timer after", flavor: "live", limit: 5 }],
    ["get_api", { name: "C_Timer.After", flavor: "live" }],
    ["get_api", { name: "PLAYER_ENTERING_WORLD", flavor: "classic_era" }],
    ["diff_api", { name: "C_AddOns.GetAddOnMetadata" }],
    ["diff_flavors", { from: "live", to: "ptr2", kind: "function", direction: "added", limit: 10 }],
    ["detect_wow_install", {}],
    ["resolve_flavor", { interfaceVersion: 11509 }],
    ["resolve_flavor", { version: "12.1.0.69814", product: "wow" }],
    ["check_addon_compatibility", { path: "." }],
    ["search_wiki", { query: "TOC format", limit: 3 }],
    ["get_wiki_page", { title: "TOC format", maxChars: 2000 }],
    ["search_source", { pattern: "SecureActionButtonTemplate", flavor: "classic_era", maxResults: 5 }],
    ["list_source_files", { glob: "Interface/AddOns/Blizzard_APIDocumentationGenerated/*Timer*", flavor: "classic_era" }],
    ["get_source_file", { path: "Interface/AddOns/Blizzard_APIDocumentationGenerated", flavor: "classic_era" }],
  ];

  console.log(`Flavors available: ${availableFlavors().join(", ")}\n`);

  let failures = 0;
  for (const [name, args] of calls) {
    process.stdout.write(`\n▶ ${name} ${JSON.stringify(args)}\n`);
    try {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.map((c) => c.text ?? "").join("\n");
      if (result.isError) throw new Error(text);
      console.log(first(text));
    } catch (error) {
      failures += 1;
      console.error(`  ✗ FAILED: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(failures === 0 ? "\n✅ smoke: all tools OK" : `\n❌ smoke: ${failures} tool call(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
