import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBuildInfo, readFlavorInfo } from "../src/install/build-info.js";
import { decodeExeVersion, findInstallRoot, inspectInstall } from "../src/install/detect.js";
import { resolveFlavor } from "../src/install/resolve.js";
import { parseToc, readAddonTocs } from "../src/install/toc.js";
import { interfaceVersionFromBuild, parseBuild } from "../src/types.js";

let root: string;

const BUILD_INFO_HEADER =
  "Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wow-install-"));
  fs.writeFileSync(
    path.join(root, ".build.info"),
    [
      BUILD_INFO_HEADER,
      "us|1|12.1.0.69814|wow",
      "us|1|1.15.9.69722|wow_classic_era",
      "us|1|2.5.6.69110|wow_classic_era_ptr",
      "us|1|1.60.1.69893|wow_classic_beta",
      "us|0||wow_classic",
    ].join("\n"),
  );
  for (const [dir, product] of [
    ["_retail_", "wow"],
    ["_classic_era_", "wow_classic_era"],
    ["_classic_era_ptr_", "wow_classic_era_ptr"],
    ["_classic_beta_", "wow_classic_beta"],
  ] as const) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, ".flavor.info"), `## Product Flavor!STRING:0\n${product}\n`);
  }
  // A leftover directory holding only addon data, with no client in it.
  fs.mkdirSync(path.join(root, "_anniversary_", "Interface", "AddOns", "Stale"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "_anniversary_", "Interface", "AddOns", "Stale", "Stale.toc"),
    "## Interface: 110107\n## Title: Stale\n",
  );
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("build metadata files", () => {
  it("parses .build.info rows", () => {
    const rows = readBuildInfo(root);
    expect(rows).toContainEqual(
      expect.objectContaining({ product: "wow", version: "12.1.0.69814", active: true }),
    );
    expect(rows.find((r) => r.product === "wow_classic")).toMatchObject({ active: false, version: "" });
  });

  it("returns [] for a directory without .build.info", () => {
    expect(readBuildInfo(path.join(root, "_retail_"))).toEqual([]);
  });

  it("reads the product code from .flavor.info", () => {
    expect(readFlavorInfo(path.join(root, "_retail_"))).toBe("wow");
    expect(readFlavorInfo(root)).toBeUndefined();
  });
});

describe("executable version decoding", () => {
  it("unpacks Blizzard's digit-group encoding for builds above 65535", () => {
    expect(decodeExeVersion("1201.0.6981.4")).toBe("12.1.0.69814");
    expect(decodeExeVersion("505.4.6958.5")).toBe("5.5.4.69585");
    expect(decodeExeVersion("115.9.6972.2")).toBe("1.15.9.69722");
    expect(decodeExeVersion("160.1.6989.3")).toBe("1.60.1.69893");
  });

  it("passes plain four-part versions through", () => {
    expect(decodeExeVersion("12.0.1.65448")).toBe("12.0.1.65448");
    expect(decodeExeVersion("11.2.7.64587")).toBe("11.2.7.64587");
  });
});

describe("build parsing", () => {
  it("derives TOC interface numbers", () => {
    expect(interfaceVersionFromBuild("12.1.0.69814")).toBe(120100);
    expect(interfaceVersionFromBuild("1.15.9.69722")).toBe(11509);
    expect(interfaceVersionFromBuild("5.5.4.69585")).toBe(50504);
    expect(parseBuild("2.5.6")).toEqual([2, 5, 6, 0]);
  });
});

describe("flavor resolution", () => {
  it("prefers an exact build match", () => {
    const result = resolveFlavor({ product: "wow_classic_era", version: "1.15.9.69722" });
    expect(result.best?.flavor).toBe("classic_era");
    expect(result.confidence).toBe("exact");
  });

  it("lets the build override a misleading product code", () => {
    // The 1.60 "Forever" client ships under the wow_classic_beta product, but
    // its build belongs to the `forever` track, not `classic_beta` (5.5.0).
    const result = resolveFlavor({ product: "wow_classic_beta", version: "1.60.1.69893" });
    expect(result.best?.flavor).toBe("forever");
  });

  it("maps the Anniversary PTR product onto the matching build", () => {
    const result = resolveFlavor({ product: "wow_classic_era_ptr", version: "2.5.6.69110" });
    expect(result.best?.flavor).toBe("classic_era_ptr");
  });

  it("resolves from a TOC interface number alone", () => {
    expect(resolveFlavor({ interfaceVersion: 11509 }).best?.flavor).toBe("classic_era");
  });

  it("reports no match for a nonsense build", () => {
    const result = resolveFlavor({ version: "99.9.9.99999" });
    expect(result.best).toBeUndefined();
    expect(result.confidence).toBe("none");
  });
});

describe("install detection", () => {
  it("finds the install root from a nested path", () => {
    const nested = path.join(root, "_retail_", "Interface", "AddOns");
    fs.mkdirSync(nested, { recursive: true });
    expect(findInstallRoot(nested)).toBe(root);
  });

  it("returns undefined outside any install", () => {
    expect(findInstallRoot(os.tmpdir())).toBeUndefined();
  });

  it("resolves each installed client to a flavor", () => {
    const install = inspectInstall(root);
    const byDir = new Map(install.clients.map((c) => [c.directory, c]));
    expect(byDir.get("_retail_")?.resolution.best?.flavor).toBe("live");
    expect(byDir.get("_classic_era_")?.resolution.best?.flavor).toBe("classic_era");
    expect(byDir.get("_classic_era_ptr_")?.resolution.best?.flavor).toBe("classic_era_ptr");
    expect(byDir.get("_classic_beta_")?.resolution.best?.flavor).toBe("forever");
    expect(byDir.get("_retail_")?.versionSource).toBe("build.info");
  });

  it("does not resolve a directory that holds only leftover addon data", () => {
    const stale = inspectInstall(root).clients.find((c) => c.directory === "_anniversary_");
    expect(stale?.clientPresent).toBe(false);
    expect(stale?.resolution.best).toBeUndefined();
  });
});

describe("toc parsing", () => {
  it("reads interface numbers and flavor suffixes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "addon-"));
    fs.writeFileSync(path.join(dir, "MyAddon_Mainline.toc"), "## Interface: 120100\n## Title: My Addon\n");
    fs.writeFileSync(path.join(dir, "MyAddon_Vanilla.toc"), "## Interface: 11509, 11507\n");
    const tocs = readAddonTocs(dir).sort((a, b) => a.file.localeCompare(b.file));
    expect(tocs).toHaveLength(2);
    expect(tocs[0]).toMatchObject({ addon: "MyAddon", suffix: "Mainline", interfaceVersions: [120100] });
    expect(tocs[1]!.interfaceVersions).toEqual([11509, 11507]);
    expect(tocs[0]!.title).toBe("My Addon");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignores a .toc with no Interface directive", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "addon-"));
    fs.writeFileSync(path.join(dir, "Empty.toc"), "## Title: Nothing\n");
    expect(readAddonTocs(dir)).toEqual([]);
    expect(parseToc(path.join(dir, "Missing.toc"))).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
