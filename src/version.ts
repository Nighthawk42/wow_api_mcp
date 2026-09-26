/** Single source of truth for the server version: package.json. */
import fs from "node:fs";
import path from "node:path";

function read(): string {
  for (const dir of [path.resolve(import.meta.dirname, ".."), path.resolve(import.meta.dirname, "..", "..")]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Try the next candidate: src/ and dist/ sit at different depths.
    }
  }
  return "0.0.0";
}

export const SERVER_VERSION = read();
export const USER_AGENT = `wow-api-mcp/${SERVER_VERSION} (https://github.com/Nighthawk42/wow_api_mcp)`;
