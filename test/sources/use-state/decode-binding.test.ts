import { describe, expect, it } from "vitest";
import type { StateVarDecl } from "modality-ts/core";
import { useStateSource } from "modality-ts/extract/sources/use-state";

function legacySetterBindingFromDecl(decl: StateVarDecl) {
  const localMatch = /^local:([^.]+)\.(.+)$/.exec(decl.id);
  const atomMatch = /^atom:(.+)$/.exec(decl.id);
  const familyMatch = /^atom-family:([^:]+):/.exec(decl.id);
  const swrMatch = /^swr:(.+):data$/.exec(decl.id);
  return {
    varId: decl.id,
    component: localMatch?.[1] ?? "Anonymous",
    stateName:
      localMatch?.[2] ??
      familyMatch?.[1] ??
      atomMatch?.[1]?.replace(/@store:.+$/, "") ??
      swrMatch?.[1] ??
      decl.id,
    domain: decl.domain,
    initial: decl.initial,
  };
}

describe("useState decodeBinding", () => {
  const plugin = useStateSource();

  it("decodes local useState var ids", () => {
    const decl: StateVarDecl = {
      id: "local:App.count",
      domain: { kind: "boundedInt", min: 0, max: 9 },
      initial: 0,
    };
    expect(plugin.decodeBinding?.(decl)).toEqual(
      legacySetterBindingFromDecl(decl),
    );
  });

  it("returns undefined for foreign var ids", () => {
    const decl: StateVarDecl = {
      id: "atom:countAtom",
      domain: { kind: "int" },
    };
    expect(plugin.decodeBinding?.(decl)).toBeUndefined();
  });
});
