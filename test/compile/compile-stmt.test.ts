import {
  compileStatements,
  type CompileStmtOptions,
} from "modality-ts/extract/compile";
import type {
  CompileCtx,
  LeafDispatch,
  LeafEffect,
} from "modality-ts/extract/engine/spi";
import type { SurfaceCall, SurfaceStmt } from "modality-ts/extract/engine/spi";
import { describe, expect, it } from "vitest";

function stubLeaf(effect: LeafEffect): LeafDispatch {
  return {
    interpretCall: () => effect,
    interpretExpr: () => undefined,
    interpretBoundary: () => undefined,
  };
}

function compileWith(
  stmts: SurfaceStmt[],
  leaf: LeafDispatch,
  locals: CompileCtx["locals"] = new Map([
    [
      "a",
      { expr: { kind: "read", var: "a" }, reads: ["a"] },
    ],
    [
      "p",
      { expr: { kind: "read", var: "p" }, reads: ["p"] },
    ],
  ]),
): ReturnType<typeof compileStatements> {
  const ctx: CompileCtx = {
    symbols: {
      resolve: () => undefined,
      localSymbolKey: () => undefined,
      importBinding: () => undefined,
      typeOf: () => undefined,
    },
    locals,
    snapshotReads: true,
    caveats: [],
  };
  const options: CompileStmtOptions = { leaf, ctx };
  return compileStatements(stmts, options);
}

describe("compile-stmt", () => {
  it("lowers handleX if(setX(p)) to guarded assign", () => {
    const stmts: SurfaceStmt[] = [
      {
        kind: "if",
        cond: { kind: "ref", symbol: { name: "a", origin: { file: "f", start: 0, end: 1 } } },
        then: {
          kind: "block",
          stmts: [
            {
              kind: "expr",
              expr: {
                kind: "call",
                callee: {
                  kind: "ref",
                  symbol: { name: "setX", origin: { file: "f", start: 2, end: 3 } },
                },
                args: [
                  {
                    kind: "ref",
                    symbol: { name: "p", origin: { file: "f", start: 4, end: 5 } },
                  },
                ],
                origin: { file: "f", start: 2, end: 6 },
              },
            },
          ],
        },
      },
    ];
    const compiled = compileWith(stmts, stubLeaf({
      effect: {
        kind: "assign",
        var: "local:C.X",
        expr: { kind: "read", var: "p" },
      },
    }));
    expect(compiled?.effect).toEqual({
      kind: "if",
      cond: { kind: "read", var: "a" },
      then: {
        kind: "assign",
        var: "local:C.X",
        expr: { kind: "read", var: "p" },
      },
      else: { kind: "seq", effects: [] },
    });
  });

  it("over-approximates loops via havoc with caveat", () => {
    const compiled = compileWith(
      [
        {
          kind: "for",
          body: { kind: "block", stmts: [] },
          loopKind: "while",
        },
      ],
      stubLeaf({ effect: { kind: "seq", effects: [] } }),
      new Map(),
    );
    expect(compiled?.effect).toEqual({ kind: "seq", effects: [] });
    const compiledWithLoop = compileWith(
      [
        {
          kind: "for",
          body: { kind: "block", stmts: [] },
          loopKind: "while",
        },
      ],
      stubLeaf({ effect: { kind: "seq", effects: [] } }),
      new Map(),
    );
    const withVars = compileStatements(
      [
        {
          kind: "for",
          body: { kind: "block", stmts: [] },
          loopKind: "for",
        },
      ],
      {
        leaf: stubLeaf({ effect: { kind: "seq", effects: [] } }),
        ctx: {
          symbols: {
            resolve: () => undefined,
            localSymbolKey: () => undefined,
            importBinding: () => undefined,
            typeOf: () => undefined,
          },
          locals: new Map(),
          snapshotReads: true,
          caveats: [],
        },
        loopVars: ["local:C.count"],
      },
    );
    expect(withVars?.effect).toEqual({
      kind: "havoc",
      var: "local:C.count",
    });
    expect(withVars?.caveats[0]?.kind).toBe("model-slack");
    expect(compiledWithLoop?.caveats).toEqual([]);
  });

  it("lowers blocks to seq", () => {
    const compiled = compileWith(
      [
        {
          kind: "block",
          stmts: [
            {
              kind: "expr",
              expr: {
                kind: "call",
                callee: {
                  kind: "ref",
                  symbol: { name: "setX", origin: { file: "f", start: 1, end: 2 } },
                },
                args: [],
                origin: { file: "f", start: 1, end: 3 },
              },
            },
            {
              kind: "expr",
              expr: {
                kind: "call",
                callee: {
                  kind: "ref",
                  symbol: { name: "setY", origin: { file: "f", start: 4, end: 5 } },
                },
                args: [],
                origin: { file: "f", start: 4, end: 6 },
              },
            },
          ],
        },
      ],
      {
        interpretCall(call: SurfaceCall) {
          const name =
            call.callee.kind === "ref" ? call.callee.symbol.name : "unknown";
          return {
            effect: {
              kind: "assign",
              var: `local:C.${name}`,
              expr: { kind: "lit", value: 1 },
            },
          };
        },
        interpretExpr: () => undefined,
        interpretBoundary: () => undefined,
      },
    );
    expect(compiled?.effect).toEqual({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: "local:C.setX",
          expr: { kind: "lit", value: 1 },
        },
        {
          kind: "assign",
          var: "local:C.setY",
          expr: { kind: "lit", value: 1 },
        },
      ],
    });
  });
});
