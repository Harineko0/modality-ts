import { describe, expect, it } from "vitest";
import {
  applyMetamorphicTransform,
  enumerateMetamorphicSites,
} from "../../tools/metamorphic/transforms.js";

describe("metamorphic transforms", () => {
  it("inserts comments and whitespace without changing a simple program result", () => {
    const source = "export function value() { return 1 + 2; }\n";
    const [site] = enumerateMetamorphicSites(source, "sample.ts", [
      "comment-whitespace",
    ]);

    expect(site?.transformId).toBe("comment-whitespace");
    const transformed = applyMetamorphicTransform(source, site!, "sample.ts");

    expect(transformed.text).toContain("metamorphic: whitespace/comment");
    expect(evaluateReturn(transformed.text)).toBe(3);
  });

  it("alpha-renames safe block locals and rejects shorthand capture hazards", () => {
    const source = "export function value() { const x = 2; return x + 1; }\n";
    const [site] = enumerateMetamorphicSites(source, "sample.ts", [
      "local-variable-rename",
    ]);

    expect(site?.transformId).toBe("local-variable-rename");
    const transformed = applyMetamorphicTransform(source, site!, "sample.ts");

    expect(transformed.text).toContain("__mm_x");
    expect(evaluateReturn(transformed.text)).toBe(3);
    expect(
      enumerateMetamorphicSites(
        "export function value() { const x = 2; return { x }; }\n",
        "sample.ts",
        ["local-variable-rename"],
      ),
    ).toHaveLength(0);
  });

  it("reorders only adjacent independent const statements", () => {
    const safe = [
      "export function value() {",
      "  const a = 1;",
      "  const b = 2;",
      "  return a + b;",
      "}",
    ].join("\n");
    const [site] = enumerateMetamorphicSites(safe, "sample.ts", [
      "reorder-independent-statements",
    ]);

    expect(site?.transformId).toBe("reorder-independent-statements");
    expect(
      evaluateReturn(applyMetamorphicTransform(safe, site!, "sample.ts").text),
    ).toBe(3);
    expect(
      enumerateMetamorphicSites(
        "export function value() { const a = 1; const b = a + 1; return b; }\n",
        "sample.ts",
        ["reorder-independent-statements"],
      ),
    ).toHaveLength(0);
    expect(
      enumerateMetamorphicSites(
        "export async function value() { const a = await load(); const b = 1; return b; }\n",
        "sample.ts",
        ["reorder-independent-statements"],
      ),
    ).toHaveLength(0);
  });

  it("extracts pure return expressions and rejects impure calls", () => {
    const source = "export function value() { const x = 2; return x + 1; }\n";
    const [site] = enumerateMetamorphicSites(source, "sample.ts", [
      "extract-subexpression-to-const",
    ]);

    expect(site?.transformId).toBe("extract-subexpression-to-const");
    const transformed = applyMetamorphicTransform(source, site!, "sample.ts");

    expect(transformed.text).toContain("const __mm_expr");
    expect(evaluateReturn(transformed.text)).toBe(3);
    expect(
      enumerateMetamorphicSites(
        "export function value() { return compute(); }\n",
        "sample.ts",
        ["extract-subexpression-to-const"],
      ),
    ).toHaveLength(0);
  });

  it("lifts only static hook-free JSX subtrees", () => {
    const safe =
      "export function View() { return <section><span>Hello</span></section>; }\n";
    const sites = enumerateMetamorphicSites(safe, "sample.tsx", [
      "extract-subcomponent",
    ]);

    expect(sites.length).toBeGreaterThan(0);
    const transformed = applyMetamorphicTransform(
      safe,
      sites[0]!,
      "sample.tsx",
    );
    expect(transformed.text).toContain("function __MmExtractedSubtree");
    expect(
      enumerateMetamorphicSites(
        "export function View() { const [x] = useState(0); return <span>{x}</span>; }\n",
        "sample.tsx",
        ["extract-subcomponent"],
      ),
    ).toHaveLength(0);
  });
});

function evaluateReturn(source: string): unknown {
  const runnable = source.replace(/export function value/, "function value");
  return Function(`${runnable}; return value();`)();
}
