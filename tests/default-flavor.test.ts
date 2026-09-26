import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultFlavor, resetDefaultFlavor } from "../src/default-flavor.js";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetDefaultFlavor();
});

function fakeInstall(products: Array<[string, string, string]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wow-default-"));
  fs.writeFileSync(
    path.join(root, ".build.info"),
    ["Active!DEC:1|Version!STRING:0|Product!STRING:0", ...products.map(([, version, product]) => `1|${version}|${product}`)].join("\n"),
  );
  for (const [dir, , product] of products) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, ".flavor.info"), `## Product Flavor!STRING:0\n${product}\n`);
  }
  return root;
}

describe("defaultFlavor", () => {
  it("falls back to live with no environment hints", () => {
    delete process.env.WOW_API_MCP_FLAVOR;
    delete process.env.WOW_INSTALL_PATH;
    expect(defaultFlavor()).toBe("live");
  });

  it("honours an explicit pin", () => {
    process.env.WOW_API_MCP_FLAVOR = "classic_era";
    expect(defaultFlavor()).toBe("classic_era");
  });

  it("ignores a pin naming an unavailable flavor", () => {
    process.env.WOW_API_MCP_FLAVOR = "not_a_flavor";
    expect(defaultFlavor()).toBe("live");
  });

  it("prefers the retail client when several are installed", () => {
    const root = fakeInstall([
      ["_classic_", "5.5.4.69585", "wow_classic"],
      ["_retail_", "12.1.0.69814", "wow"],
      ["_ptr_", "12.1.0.69587", "wowt"],
    ]);
    process.env.WOW_INSTALL_PATH = root;
    expect(defaultFlavor()).toBe("live");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses the only installed client when it is not retail", () => {
    const root = fakeInstall([["_classic_era_", "1.15.9.69722", "wow_classic_era"]]);
    process.env.WOW_INSTALL_PATH = root;
    expect(defaultFlavor()).toBe("classic_era");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("prefers a release client over a test realm", () => {
    const root = fakeInstall([
      ["_classic_era_ptr_", "2.5.6.69110", "wow_classic_era_ptr"],
      ["_classic_era_", "1.15.9.69722", "wow_classic_era"],
    ]);
    process.env.WOW_INSTALL_PATH = root;
    expect(defaultFlavor()).toBe("classic_era");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("falls back when the install path holds no WoW", () => {
    process.env.WOW_INSTALL_PATH = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"));
    expect(defaultFlavor()).toBe("live");
  });
});
