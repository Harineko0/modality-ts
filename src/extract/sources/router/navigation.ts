export function navigationCall(
  callee: string,
  args: readonly unknown[],
): { mode: "push" | "replace" | "back"; to?: string } | "unsupported" {
  if (callee === "navigate" && args.length === 1 && typeof args[0] === "string")
    return { mode: "push", to: args[0] };
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
