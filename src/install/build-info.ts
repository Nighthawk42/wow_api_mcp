/**
 * Readers for the small metadata files Battle.net drops into a World of
 * Warcraft installation.
 *
 * Both use the same pipe-delimited "Blizzard CSV" shape: a header row of
 * `Name!TYPE:size` columns followed by data rows.
 *
 *   .build.info    at the install root, one row per installed product
 *   .flavor.info   inside each `_retail_` / `_classic_` / ... directory
 */
import fs from "node:fs";
import path from "node:path";

export interface BuildInfoRow {
  /** Blizzard product code, e.g. `wow`, `wow_classic_era`, `wowt`. */
  product: string;
  /** Build string, e.g. "12.1.0.69875". Empty when the column is blank. */
  version: string;
  branch?: string;
  active: boolean;
  tags?: string;
}

function parseDelimited(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  // Header cells look like "Version!STRING:0"; keep the name before "!".
  const headers = lines[0]!.split("|").map((h) => h.split("!")[0]!.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("|");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

/** Reads `<installRoot>/.build.info`. Returns [] when absent or unreadable. */
export function readBuildInfo(installRoot: string): BuildInfoRow[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(installRoot, ".build.info"), "utf8");
  } catch {
    return [];
  }
  const rows: BuildInfoRow[] = [];
  for (const row of parseDelimited(text)) {
    const product = row["Product"] ?? "";
    if (!product) continue;
    rows.push({
      product,
      version: row["Version"] ?? "",
      branch: row["Branch"] || undefined,
      active: row["Active"] !== "0",
      tags: row["Tags"] || undefined,
    });
  }
  return rows;
}

/**
 * Reads the product code from `<flavorDir>/.flavor.info`. The file is two
 * lines: a `Product Flavor!STRING:0` header and the code itself.
 */
export function readFlavorInfo(flavorDir: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(flavorDir, ".flavor.info"), "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const value = lines[1];
  return value && !value.includes("!") ? value : undefined;
}
