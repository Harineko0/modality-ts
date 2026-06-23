import type { StateVarDecl } from "modality-ts/core";
import type { DecodedSetterBinding } from "modality-ts/extract/engine/spi";

export function decodeJotaiBinding(
  decl: StateVarDecl,
): DecodedSetterBinding | undefined {
  const atomMatch = /^atom:(.+)$/.exec(decl.id);
  if (atomMatch) {
    return {
      varId: decl.id,
      component: "Anonymous",
      stateName: atomMatch[1]!.replace(/@store:.+$/, ""),
      domain: decl.domain,
      initial: decl.initial,
    };
  }
  const familyMatch = /^atom-family:([^:]+):/.exec(decl.id);
  if (!familyMatch) return undefined;
  return {
    varId: decl.id,
    component: "Anonymous",
    stateName: familyMatch[1]!,
    domain: decl.domain,
    initial: decl.initial,
  };
}
