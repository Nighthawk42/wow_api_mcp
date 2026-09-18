/**
 * Reads the version resource out of a Windows PE executable (Wow.exe,
 * WowClassic.exe, WowT.exe, WowB.exe, ...) without shelling out, so it works
 * from any OS against a mounted install.
 *
 * Walks DOS header → PE header → section table → resource directory
 * (RT_VERSION) → VS_FIXEDFILEINFO. Only the first few hundred KB of the file
 * are read for the headers; the resource blob itself is read separately.
 */
import fs from "node:fs";

const RT_VERSION = 16;
const VS_FIXEDFILEINFO_SIGNATURE = 0xfeef04bd;

interface Section {
  virtualAddress: number;
  virtualSize: number;
  rawAddress: number;
  rawSize: number;
}

function rvaToOffset(sections: Section[], rva: number): number | undefined {
  for (const s of sections) {
    const size = s.virtualSize || s.rawSize;
    if (rva >= s.virtualAddress && rva < s.virtualAddress + size) {
      return s.rawAddress + (rva - s.virtualAddress);
    }
  }
  return undefined;
}

/** Depth-first walk to the first IMAGE_RESOURCE_DATA_ENTRY under a resource type. */
function findResourceData(
  buf: Buffer,
  resourceBase: number,
  dirOffset: number,
  wantId: number | undefined,
  depth: number,
): { rva: number; size: number } | undefined {
  if (dirOffset + 16 > buf.length) return undefined;
  const named = buf.readUInt16LE(dirOffset + 12);
  const ided = buf.readUInt16LE(dirOffset + 14);
  const total = named + ided;
  for (let i = 0; i < total; i++) {
    const entry = dirOffset + 16 + i * 8;
    if (entry + 8 > buf.length) return undefined;
    const nameField = buf.readUInt32LE(entry);
    const offsetField = buf.readUInt32LE(entry + 4);
    const isNamed = (nameField & 0x80000000) !== 0;
    if (wantId !== undefined && (isNamed || nameField !== wantId)) continue;

    if ((offsetField & 0x80000000) !== 0) {
      const child = findResourceData(buf, resourceBase, resourceBase + (offsetField & 0x7fffffff), undefined, depth + 1);
      if (child) return child;
    } else if (resourceBase + offsetField + 16 <= buf.length) {
      const data = resourceBase + offsetField;
      return { rva: buf.readUInt32LE(data), size: buf.readUInt32LE(data + 4) };
    }
  }
  return undefined;
}

export interface PeVersion {
  /** Dotted file version from VS_FIXEDFILEINFO, e.g. "12.1.0.69814". */
  fileVersion: string;
  productVersion: string;
}

/**
 * Returns the executable's version resource, or undefined when the file is not
 * a readable PE image or carries no version resource.
 */
export function readPeVersion(exePath: string): PeVersion | undefined {
  let fd: number;
  try {
    fd = fs.openSync(exePath, "r");
  } catch {
    return undefined;
  }
  try {
    const head = Buffer.alloc(4096);
    if (fs.readSync(fd, head, 0, head.length, 0) < 512) return undefined;
    if (head.readUInt16LE(0) !== 0x5a4d) return undefined; // "MZ"

    const peOffset = head.readUInt32LE(0x3c);
    if (peOffset + 24 > head.length || head.readUInt32LE(peOffset) !== 0x00004550) return undefined; // "PE\0\0"

    const sectionCount = head.readUInt16LE(peOffset + 6);
    const optionalSize = head.readUInt16LE(peOffset + 20);
    const optionalOffset = peOffset + 24;
    const magic = head.readUInt16LE(optionalOffset);
    const dataDirOffset = optionalOffset + (magic === 0x20b ? 112 : 96); // PE32+ vs PE32
    const resourceDirEntry = dataDirOffset + 2 * 8;
    if (resourceDirEntry + 8 > head.length) return undefined;
    const resourceRva = head.readUInt32LE(resourceDirEntry);
    const resourceSize = head.readUInt32LE(resourceDirEntry + 4);
    if (!resourceRva || !resourceSize) return undefined;

    const sectionTable = optionalOffset + optionalSize;
    const sections: Section[] = [];
    for (let i = 0; i < sectionCount; i++) {
      const off = sectionTable + i * 40;
      if (off + 40 > head.length) break;
      sections.push({
        virtualSize: head.readUInt32LE(off + 8),
        virtualAddress: head.readUInt32LE(off + 12),
        rawSize: head.readUInt32LE(off + 16),
        rawAddress: head.readUInt32LE(off + 20),
      });
    }

    const resourceOffset = rvaToOffset(sections, resourceRva);
    if (resourceOffset === undefined) return undefined;
    // Read the whole .rsrc section once; RVAs inside it are section-relative.
    const rsrc = Buffer.alloc(resourceSize);
    const read = fs.readSync(fd, rsrc, 0, resourceSize, resourceOffset);
    if (read < 16) return undefined;

    const entry = findResourceData(rsrc, 0, 0, RT_VERSION, 0);
    if (!entry) return undefined;
    const blobOffset = entry.rva - resourceRva;
    if (blobOffset < 0 || blobOffset + 4 > rsrc.length) return undefined;
    const blob = rsrc.subarray(blobOffset, Math.min(blobOffset + entry.size, rsrc.length));

    // Locate VS_FIXEDFILEINFO by its signature rather than by walking the
    // variable-length szKey/padding that precedes it.
    let sig = -1;
    for (let i = 0; i + 4 <= blob.length; i += 4) {
      if (blob.readUInt32LE(i) === VS_FIXEDFILEINFO_SIGNATURE) {
        sig = i;
        break;
      }
    }
    if (sig < 0 || sig + 24 > blob.length) return undefined;

    const dotted = (ms: number, ls: number) =>
      [(ms >>> 16) & 0xffff, ms & 0xffff, (ls >>> 16) & 0xffff, ls & 0xffff].join(".");
    return {
      fileVersion: dotted(blob.readUInt32LE(sig + 8), blob.readUInt32LE(sig + 12)),
      productVersion: dotted(blob.readUInt32LE(sig + 16), blob.readUInt32LE(sig + 20)),
    };
  } catch {
    return undefined;
  } finally {
    fs.closeSync(fd);
  }
}
