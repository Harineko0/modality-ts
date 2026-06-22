import type { StateVarDecl } from "modality-ts/core";
import type { DecodedSetterBinding } from "modality-ts/extract/engine/spi";

export function decodeUseStateBinding(
  decl: StateVarDecl,
): DecodedSetterBinding | undefined {
  const localMatch = /^local:([^.]+)\.(.+)$/.exec(decl.id);
  if (!localMatch) return undefined;
  return {
    varId: decl.id,
    component: localMatch[1]!,
    stateName: localMatch[2]!,
    domain: decl.domain,
    initial: decl.initial,
  };
}
