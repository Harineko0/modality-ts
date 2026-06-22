import { describe, expect, it } from "vitest";
import type { StateVarDecl } from "modality-ts/core";
import { swrSource } from "modality-ts/extract/sources/swr";

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

describe("swr decodeBinding", () => {
  const plugin = swrSource();

  it("decodes swr data var ids", () => {
    const decl: StateVarDecl = {
      id: "swr:api_todos:data",
      domain: { kind: "lengthCat" },
      initial: null,
    };
    expect(plugin.decodeBinding?.(decl)).toEqual(
      legacySetterBindingFromDecl(decl),
    );
  });

  it("returns undefined for foreign var ids", () => {
    const decl: StateVarDecl = {
      id: "swr:api_todos:isValidating",
      domain: { kind: "bool" },
    };
    expect(plugin.decodeBinding?.(decl)).toBeUndefined();
  });
});
