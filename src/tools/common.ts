/** Shared zod schemas and response helpers for the tool modules. */
import { z } from "zod";
import { flavorSpec } from "../flavors.js";
import { availableFlavors } from "../data/manifest.js";
import { defaultFlavor } from "../default-flavor.js";

/**
 * Tool annotations. Every tool here only reads, so clients that auto-approve
 * read-only tools can do so; the network-backed ones are flagged open-world.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Read-only, but reaches warcraft.wiki.gg or GitHub. */
export const READ_ONLY_NETWORK = { ...READ_ONLY, openWorldHint: true } as const;

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

/** A result the client should treat as a failed call. */
export function errorText(body: string): ToolResult {
  return { content: [{ type: "text", text: body }], isError: true };
}

/** One-line summary of every available flavor, for tool descriptions. */
export function flavorSummary(): string {
  return availableFlavors()
    .map((id) => `${id} (${flavorSpec(id).label})`)
    .join(", ");
}

/**
 * The `flavor` argument. The enum is built from what `data/` actually holds,
 * so a newly ingested upstream track is selectable without a code change.
 */
export function flavorArg(description = "Which client flavor to query") {
  const flavors = availableFlavors();
  const base = flavors.length > 0 ? z.enum(flavors as [string, ...string[]]) : z.string();
  return base
    .default(defaultFlavor())
    .describe(
      `${description}. Defaults to ${defaultFlavor()}. Available: ${flavorSummary()}. ` +
        "Use detect_wow_install or resolve_flavor if you are unsure which one an addon targets.",
    );
}

/** Wraps a tool handler so unexpected errors come back as readable text. */
export function guard<T extends unknown[]>(
  handler: (...args: T) => Promise<ToolResult>,
): (...args: T) => Promise<ToolResult> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorText(message);
    }
  };
}
