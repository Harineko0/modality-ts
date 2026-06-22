import { describe, expect, it } from "vitest";
import type { StateVarDecl } from "modality-ts/core";
import { jotaiSource } from "modality-ts/extract/sources/jotai";

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

describe("jotai decodeBinding", () => {
  const plugin = jotaiSource();

  it("decodes atom var ids and strips store scopes", () => {
    const decl: StateVarDecl = {
      id: "atom:countAtom@store:provider:App",
      domain: { kind: "int" },
      initial: 0,
    };
    expect(plugin.decodeBinding?.(decl)).toEqual(
      legacySetterBindingFromDecl(decl),
    );
  });

  it("decodes atom-family var ids", () => {
    const decl: StateVarDecl = {
      id: 'atom-family:itemAtom:"a"',
      domain: { kind: "tokens", count: 1 },
    };
    expect(plugin.decodeBinding?.(decl)).toEqual(
      legacySetterBindingFromDecl(decl),
    );
  });

  it("returns undefined for foreign var ids", () => {
    const decl: StateVarDecl = {
      id: "local:App.count",
      domain: { kind: "int" },
    };
    expect(plugin.decodeBinding?.(decl)).toBeUndefined();
  });
});
