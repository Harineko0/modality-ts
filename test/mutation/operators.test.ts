import { describe, expect, it } from "vitest";
import {
  applyMutation,
  enumerateMutationSites,
} from "../../tools/mutation/operators.js";

describe("mutation operators", () => {
  it("enumerates stable conditional boundary sites", () => {
    const source = "export const ok = (count: number) => count < 3;\n";
    const first = enumerateMutationSites(source, "sample.ts", [
      "conditional-boundary",
    ]);
    const second = enumerateMutationSites(source, "sample.ts", [
      "conditional-boundary",
    ]);

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]?.siteId).toMatch(/^conditional-boundary:1:/);
    expect(applyMutation(source, first[0]!, "sample.ts").mutatedText).toContain(
      "count <= 3",
    );
  });

  it("drops setX call statements without mutating neighbouring code", () => {
    const source = [
      "function Component() {",
      "  setCount(count + 1);",
      "  return count;",
      "}",
      "",
    ].join("\n");
    const sites = enumerateMutationSites(source, "sample.tsx", [
      "drop-state-write",
    ]);

    expect(sites).toHaveLength(1);
    const mutation = applyMutation(source, sites[0]!, "sample.tsx");
    expect(mutation.siteId).toMatch(/^drop-state-write:1:/);
    expect(mutation.mutatedText).toContain(";");
    expect(mutation.mutatedText).toContain("return count;");
    expect(mutation.mutatedText).not.toContain("setCount");
  });

  it("swaps if and else branch bodies", () => {
    const source = [
      "function choose(flag: boolean) {",
      "  if (flag) {",
      "    return 'a';",
      "  } else {",
      "    return 'b';",
      "  }",
      "}",
      "",
    ].join("\n");
    const sites = enumerateMutationSites(source, "sample.ts", ["swap-if-else"]);
    const mutation = applyMutation(source, sites[0]!, "sample.ts");

    expect(mutation.mutatedText.indexOf("return 'b'")).toBeLessThan(
      mutation.mutatedText.indexOf("return 'a'"),
    );
  });
});
