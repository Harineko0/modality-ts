import type { NavIntent } from "modality-ts/extract/engine/spi";

export function classifyNavigationCall(
  _callee: string,
  _args: readonly unknown[],
): NavIntent | "unsupported" {
  return "unsupported";
}

export function classifyNavigationJsx(
  _tag: string,
  _attrs: ReadonlyMap<string, unknown>,
): NavIntent | "unsupported" {
  return "unsupported";
}
