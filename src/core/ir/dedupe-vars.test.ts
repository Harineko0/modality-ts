import { describe, expect, it } from "vitest";
import { dedupeVarsById } from "./dedupe-vars.js";
import type { StateVarDecl } from "./types.js";

function decl(
  id: string,
  domain: StateVarDecl["domain"] = { kind: "bool" },
): StateVarDecl {
  return {
    id,
    domain,
    origin: "library-template",
    scope: { kind: "global" },
    initial: false,
  };
}

describe("dedupeVarsById", () => {
  it("collapses identical duplicates", () => {
    const first = decl("flag");
    const deduped = dedupeVarsById([first, decl("flag")]);
    expect(deduped).toEqual([first]);
  });

  it("preserves first-seen order", () => {
    const deduped = dedupeVarsById([
      decl("b"),
      decl("a"),
      decl("b"),
      decl("c"),
    ]);
    expect(deduped.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("merges differing enum and numeric domains", () => {
    const deduped = dedupeVarsById([
      decl("status", { kind: "enum", values: ["idle"] }),
      decl("count", { kind: "boundedInt", min: 1, max: 2 }),
      decl("status", { kind: "enum", values: ["done", "idle"] }),
      decl("count", { kind: "boundedInt", min: -1, max: 5 }),
    ]);
    expect(deduped.find((item) => item.id === "status")?.domain).toEqual({
      kind: "enum",
      values: ["done", "idle"],
    });
    expect(deduped.find((item) => item.id === "count")?.domain).toEqual({
      kind: "boundedInt",
      min: -1,
      max: 5,
    });
  });

  it("is a no-op for already-unique vars", () => {
    const vars = [decl("a"), decl("b")];
    expect(dedupeVarsById(vars)).toEqual(vars);
  });

  it("rejects duplicates that differ outside the domain", () => {
    expect(() =>
      dedupeVarsById([
        decl("flag"),
        {
          ...decl("flag"),
          scope: {
            kind: "mount-local",
            id: "App",
            when: { kind: "lit", value: true },
          },
        },
      ]),
    ).toThrow("declarations differ outside domain");
  });
});
