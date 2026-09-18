/** Shared zod schemas and response helpers for the tool modules. */
import { z } from "zod";
import { flavorSpec } from "../flavors.js";
import { availableFlavors } from "../data/manifest.js";
import { defaultFlavor } from "../default-flavor.js";

export function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

export function errorText(body: string) {
  return { content: [{ type: "text" as const, text: body }], isError: true };
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
  handler: (...args: T) => Promise<ReturnType<typeof text>>,
): (...args: T) => Promise<ReturnType<typeof text>> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorText(message);
    }
  };
}
