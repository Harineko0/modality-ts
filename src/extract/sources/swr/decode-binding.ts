import type { StateVarDecl } from "modality-ts/core";
import type { DecodedSetterBinding } from "modality-ts/extract/engine/spi";

export function decodeSwrBinding(
  decl: StateVarDecl,
): DecodedSetterBinding | undefined {
  const swrMatch = /^swr:(.+):data$/.exec(decl.id);
  if (!swrMatch) return undefined;
  return {
    varId: decl.id,
    component: "Anonymous",
    stateName: swrMatch[1]!,
    domain: decl.domain,
    initial: decl.initial,
  };
}
