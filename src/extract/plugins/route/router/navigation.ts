import type { NavIntent } from "modality-ts/extract/engine/spi";

export function classifyNavigationCall(
  callee: string,
  args: readonly unknown[],
): NavIntent | "unsupported" {
  if (callee.endsWith(".forward") || callee.endsWith(".go") || callee === "go")
    return "unsupported";

  if (callee === "navigate" && args.length === 1 && typeof args[0] === "string")
    return { mode: "push", to: args[0] };

  if (
    callee === "navigate" &&
    args.length === 2 &&
    typeof args[0] === "string" &&
    isReplaceOptions(args[1])
  ) {
    return { mode: "replace", to: args[0] };
  }

  if (
    (callee.endsWith(".push") || callee.endsWith(".replace")) &&
    args.length === 1 &&
    typeof args[0] === "string"
  ) {
    return {
      mode: callee.endsWith(".replace") ? "replace" : "push",
      to: args[0],
    };
  }

  if (callee.endsWith(".back") && args.length === 0) return { mode: "back" };

  return "unsupported";
}

export function classifyNavigationJsx(
  tag: string,
  attrs: ReadonlyMap<string, unknown>,
): NavIntent | "unsupported" {
  if (tag === "Link") {
    const to = attrs.get("to");
    if (typeof to === "string") return { mode: "push", to };
    return "unsupported";
  }

  if (tag === "Navigate") {
    const to = attrs.get("to");
    if (typeof to !== "string") return "unsupported";
    return {
      mode: attrs.has("replace") ? "replace" : "push",
      to,
    };
  }

  return "unsupported";
}

function isReplaceOptions(value: unknown): value is { replace: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "replace" in value &&
    (value as { replace: unknown }).replace === true
  );
}
