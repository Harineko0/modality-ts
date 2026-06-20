import { describe, expect, it } from "vitest";
import { canSliceProperty } from "modality-ts/check";
import {
  always,
  alwaysStep,
  reachableFrom,
} from "../helpers/property-builders.js";
import {
  and,
  canonicalJson,
  canonicalState,
  enabled,
  enabledTransitionPrefix,
  enumerateDomain,
  eq,
  evalStatePredicate,
  lit,
  not,
  readVar,
  stepChanged,
  stepChangedTo,
  stepEnqueued,
  validateModel,
  validateValue,
  type AbstractDomain,
  type Model,
} from "modality-ts/core";

const bool = { kind: "bool" } as const;
const route = { kind: "enum", values: ["/"] } as const;

function baseModel(): Model {
  return {
    schemaVersion: 1,
    id: "kernel-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "sys:route",
        domain: route,
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-current", group: "default" },
        initial: "/",
      },
      {
        id: "sys:history",
        domain: { kind: "boundedList", inner: route, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-history", group: "default" },
        initial: [],
      },
      {
        id: "sys:pending",
        domain: {
          kind: "boundedList",
          inner: {
            kind: "record",
            fields: {
              opId: { kind: "enum", values: ["op"] },
              continuation: { kind: "enum", values: ["cont"] },
              args: { kind: "record", fields: {} },
            },
          },
          maxLen: 1,
        },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      {
        id: "flag",
        domain: bool,
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
      {
        id: "mode",
        domain: { kind: "enum", values: ["a", "b"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "a",
      },
    ],
    transitions: [
      {
        id: "toggle",
        cls: "user",
        label: { kind: "click", text: "Toggle" },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
        effect: {
          kind: "assign",
          var: "flag",
          expr: { kind: "lit", value: true },
        },
        reads: ["flag"],
        writes: ["flag"],
        confidence: "exact",
      },
    ],
  };
}

function fixtureVar(model: Model, index: number): Model["vars"][number] {
  const decl = model.vars[index];
  if (!decl) throw new Error(`Fixture is missing var at index ${index}`);
  return decl;
}

function firstTransition(model: Model): Model["transitions"][number] {
  const transition = model.transitions[0];
  if (!transition) throw new Error("Fixture is missing first transition");
  return transition;
}

describe("domains", () => {
  it("enumerates only values accepted by validation", () => {
    const domains: AbstractDomain[] = [
      bool,
      { kind: "enum", values: ["idle", "done"] },
      { kind: "boundedInt", min: 1, max: 3 },
      { kind: "option", inner: { kind: "enum", values: ["x"] } },
      {
        kind: "record",
        fields: { a: bool, b: { kind: "enum", values: ["x", "y"] } },
      },
      {
        kind: "tagged",
        tag: "kind",
        variants: {
          guest: { kind: "record", fields: {} },
          user: {
            kind: "record",
            fields: { id: { kind: "tokens", count: 2 } },
          },
        },
      },
      { kind: "tokens", count: 2 },
      { kind: "lengthCat" },
      { kind: "boundedList", inner: bool, maxLen: 2 },
    ];
    for (const domain of domains) {
      const values = enumerateDomain(domain);
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((value) => validateValue(domain, value))).toBe(true);
    }
  });

  it("enumerates large bounded lists without overflowing the stack", () => {
    const pendingOp = {
      kind: "record",
      fields: {
        opId: { kind: "enum", values: ["api.fetchQuote", "api.submitOrder"] },
        continuation: {
          kind: "enum",
          values: [
            "App.onChange.api.fetchQuote.cont",
            "App.onChange.api.submitOrder.cont",
            "App.onClick.api.fetchQuote.cont",
            "App.onClick.api.submitOrder.cont",
            "App.onSubmit.api.fetchQuote.cont",
            "App.onSubmit.api.submitOrder.cont",
          ],
        },
        args: {
          kind: "record",
          fields: {
            plan: { kind: "enum", values: ["none", "pro", "starter"] },
            userId: { kind: "enum", values: ["none", "u1"] },
          },
        },
      },
    } satisfies AbstractDomain;

    const values = enumerateDomain({
      kind: "boundedList",
      inner: pendingOp,
      maxLen: 3,
    });
    expect(values).toHaveLength(1 + 72 + 72 ** 2 + 72 ** 3);
  });

  it("canonicalizes JSON and token names deterministically", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    const model: Model = {
      ...baseModel(),
      vars: [
        ...baseModel().vars.filter((decl) => decl.id !== "mode"),
        {
          id: "mode",
          domain: { kind: "tokens", count: 2 },
          origin: "system",
          scope: { kind: "global" },
          initial: "tok1",
        },
      ],
    };
    const left = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "tok2",
    };
    const right = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "tok1",
    };
    expect(canonicalState(model, left)).toBe(canonicalState(model, right));
  });

  it("does not rename token-looking strings in non-token domains", () => {
    const model = baseModel();
    const left = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "tok2",
    };
    const right = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "tok1",
    };
    expect(canonicalState(model, left)).not.toBe(canonicalState(model, right));
  });

  it("preserves token equality relationships across nested token fields", () => {
    const token = { kind: "tokens", count: 2 } as const;
    const model: Model = {
      ...baseModel(),
      vars: [
        ...baseModel().vars.filter((decl) => decl.id !== "mode"),
        {
          id: "mode",
          domain: token,
          origin: "system",
          scope: { kind: "global" },
          initial: "tok1",
        },
        {
          id: "box",
          domain: { kind: "record", fields: { value: token } },
          origin: "system",
          scope: { kind: "global" },
          initial: { value: "tok1" },
        },
      ],
    };
    const sameLeft = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "tok2",
      box: { value: "tok2" },
    };
    const sameRight = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "tok1",
      box: { value: "tok1" },
    };
    const different = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "tok1",
      box: { value: "tok2" },
    };
    expect(canonicalState(model, sameLeft)).toBe(
      canonicalState(model, sameRight),
    );
    expect(canonicalState(model, sameRight)).not.toBe(
      canonicalState(model, different),
    );
  });
});

describe("validator", () => {
  it("accepts a well-formed model", () => {
    expect(validateModel(baseModel())).toEqual({ ok: true, errors: [] });
  });

  it("rejects duplicate ids and invalid initials", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      vars: [
        ...model.vars,
        { ...fixtureVar(model, 3), id: "flag", initial: "not-bool" },
      ],
    };
    const result = validateModel(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("Duplicate state var id flag");
    expect(result.errors.join("\n")).toContain("invalid initial");
  });

  it("rejects malformed abstract domains before enumeration", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      vars: [
        ...model.vars,
        {
          id: "emptyEnum",
          domain: { kind: "enum", values: [] },
          origin: "system",
          scope: { kind: "global" },
          initial: "x",
        },
        {
          id: "dupEnum",
          domain: { kind: "enum", values: ["x", "x"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "x",
        },
        {
          id: "badInt",
          domain: { kind: "boundedInt", min: 3, max: 1 },
          origin: "system",
          scope: { kind: "global" },
          initial: 1,
        },
        {
          id: "badTokens",
          domain: { kind: "tokens", count: 0, names: ["tok1"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "tok1",
        },
        {
          id: "dupTokens",
          domain: { kind: "tokens", count: 2, names: ["same", "same"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "same",
        },
        {
          id: "badList",
          domain: { kind: "boundedList", inner: bool, maxLen: -1 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "badTagged",
          domain: { kind: "tagged", tag: "kind", variants: { x: bool } },
          origin: "system",
          scope: { kind: "global" },
          initial: { kind: "x" },
        },
      ],
    };
    const errors = validateModel(broken).errors.join("\n");
    expect(errors).toContain(
      "emptyEnum: enum domain must have at least one value",
    );
    expect(errors).toContain("dupEnum: duplicate enum value x");
    expect(errors).toContain("badInt: boundedInt min must be <= max");
    expect(errors).toContain(
      "badTokens: tokens count must be a positive integer",
    );
    expect(errors).toContain("badTokens: tokens names length must match count");
    expect(errors).toContain("dupTokens: duplicate token name same");
    expect(errors).toContain(
      "badList: boundedList maxLen must be a non-negative integer",
    );
    expect(errors).toContain(
      "badTagged: tagged variant x must be a record domain",
    );
  });

  it("rejects malformed bounds and invalid role-bearing system variables", () => {
    const model = baseModel();
    const badBounds: Model = {
      ...model,
      bounds: { maxDepth: -1, maxPending: 1.5, maxInternalSteps: 0 },
    };
    const boundErrors = validateModel(badBounds).errors.join("\n");
    expect(boundErrors).toContain(
      "bounds.maxDepth must be a non-negative integer",
    );
    expect(boundErrors).toContain(
      "bounds.maxPending must be a non-negative integer",
    );
    expect(boundErrors).toContain(
      "bounds.maxInternalSteps must be a positive integer",
    );

    const boolOnly: Model = {
      schemaVersion: 1,
      id: "bool-only",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 1 },
      vars: [
        {
          id: "x",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [],
    };
    expect(validateModel(boolOnly)).toEqual({ ok: true, errors: [] });

    const badSystem: Model = {
      ...model,
      bounds: { ...model.bounds, maxPending: 2 },
      vars: model.vars.map((decl) => {
        if (decl.id === "sys:route") return { ...decl, domain: bool };
        if (decl.id === "sys:history")
          return {
            ...decl,
            domain: {
              kind: "boundedList" as const,
              inner: { kind: "enum" as const, values: ["/", "/ghost"] },
              maxLen: 1,
            },
          };
        if (decl.id === "sys:pending")
          return { ...decl, domain: { ...decl.domain, maxLen: 1 } };
        return decl;
      }),
    };
    const systemErrors = validateModel(badSystem).errors.join("\n");
    expect(systemErrors).toContain("sys:route must use an enum domain");
    expect(systemErrors).toContain(
      "sys:history inner domain must be compatible with sys:route domain",
    );
    expect(systemErrors).toContain(
      "sys:pending maxLen must match bounds.maxPending",
    );
  });

  it("accepts sys:history inner domain as a subset of sys:route", () => {
    const model = baseModel();
    const subsetHistory: Model = {
      ...model,
      vars: model.vars.map((decl) => {
        if (decl.id === "sys:route")
          return {
            ...decl,
            domain: {
              kind: "enum" as const,
              values: ["/", "/signin", "/links"],
            },
          };
        if (decl.id === "sys:history")
          return {
            ...decl,
            domain: {
              kind: "boundedList" as const,
              inner: { kind: "enum" as const, values: ["/", "/signin"] },
              maxLen: 4,
            },
          };
        return decl;
      }),
    };
    expect(validateModel(subsetHistory).ok).toBe(true);

    const foreignHistory: Model = {
      ...subsetHistory,
      vars: subsetHistory.vars.map((decl) => {
        if (decl.id === "sys:history")
          return {
            ...decl,
            domain: {
              kind: "boundedList" as const,
              inner: {
                kind: "enum" as const,
                values: ["/", "/signin", "/ghost"],
              },
              maxLen: 4,
            },
          };
        return decl;
      }),
    };
    expect(validateModel(foreignHistory).errors).toContain(
      "sys:history inner domain must be compatible with sys:route domain",
    );
  });

  it("accepts app:location and app:history role pair without sys:* names", () => {
    const locationRoute = {
      kind: "enum" as const,
      values: ["/", "/signin"],
    };
    const roleModel: Model = {
      schemaVersion: 1,
      id: "role-location",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 1 },
      vars: [
        {
          id: "app:location",
          domain: locationRoute,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current", group: "default" },
          initial: "/",
        },
        {
          id: "app:history",
          domain: {
            kind: "boundedList" as const,
            inner: { kind: "enum" as const, values: ["/"] },
            maxLen: 2,
          },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-history", group: "default" },
          initial: [],
        },
      ],
      transitions: [],
    };
    expect(validateModel(roleModel).ok).toBe(true);
  });

  it("does not apply role validation to sys:next ids without role metadata", () => {
    const nextTreeModel: Model = {
      schemaVersion: 1,
      id: "next-tree",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 1 },
      vars: [
        {
          id: "sys:next:slot:children",
          domain: { kind: "enum", values: ["__none", "page-a"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "__none",
        },
        {
          id: "sys:next:phase:layout",
          domain: { kind: "enum", values: ["ready", "loading"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "ready",
        },
      ],
      transitions: [],
    };
    expect(validateModel(nextTreeModel).ok).toBe(true);
  });

  it("rejects invalid location-current domain and duplicate group location-current vars", () => {
    const invalidCurrent: Model = {
      schemaVersion: 1,
      id: "bad-location",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 1 },
      vars: [
        {
          id: "app:location",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current", group: "default" },
          initial: false,
        },
      ],
      transitions: [],
    };
    expect(validateModel(invalidCurrent).errors).toContain(
      "app:location must use an enum domain",
    );

    const duplicateGroup: Model = {
      schemaVersion: 1,
      id: "dup-location",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 1 },
      vars: [
        {
          id: "app:a",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current", group: "default" },
          initial: "/",
        },
        {
          id: "app:b",
          domain: { kind: "enum", values: ["/home"] },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current", group: "default" },
          initial: "/home",
        },
      ],
      transitions: [],
    };
    expect(validateModel(duplicateGroup).errors.join("\n")).toContain(
      "Multiple location-current vars in group default",
    );
  });

  it("rejects undeclared guard and effect reads", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          reads: [],
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "read", var: "mode" },
          },
        },
      ],
    };
    const errors = validateModel(broken).errors.join("\n");
    expect(errors).toContain("guard reads flag");
    expect(errors).toContain("effect reads mode");
  });

  it("rejects unknown expression reads and invalid read paths", () => {
    const model = baseModel();
    const unknownExprRead: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: { kind: "read", var: "missing" },
          reads: [],
        },
      ],
    };
    expect(validateModel(unknownExprRead).errors.join("\n")).toContain(
      "toggle: expression reads unknown var missing",
    );

    const invalidRecordPath: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: {
            kind: "eq",
            args: [
              { kind: "read", var: "sys:pending", path: ["0", "nope"] },
              { kind: "lit", value: "x" },
            ],
          },
          reads: ["sys:pending"],
        },
      ],
    };
    expect(validateModel(invalidRecordPath).errors.join("\n")).toContain(
      "toggle: sys:pending has invalid read path 0.nope",
    );

    const outOfBoundsIndex: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: {
            kind: "eq",
            args: [
              { kind: "read", var: "sys:pending", path: ["1", "opId"] },
              { kind: "lit", value: "op" },
            ],
          },
          reads: ["sys:pending"],
        },
      ],
    };
    expect(validateModel(outOfBoundsIndex).errors.join("\n")).toContain(
      "toggle: sys:pending has invalid read path 1.opId",
    );
  });

  it("rejects malformed expression and effect shapes from artifacts", () => {
    const model = baseModel();
    const badExprShapes: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: {
            kind: "not",
            args: [
              { kind: "read", var: "flag" },
              { kind: "read", var: "mode" },
            ],
          } as unknown as Model["transitions"][number]["guard"],
          reads: ["flag", "mode"],
        },
      ],
    };
    expect(validateModel(badExprShapes).errors.join("\n")).toContain(
      "toggle: not expression must have exactly 1 arg",
    );

    const badCond: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: {
            kind: "cond",
            args: [
              { kind: "read", var: "flag" },
              { kind: "lit", value: true },
            ],
          } as unknown as Model["transitions"][number]["guard"],
        },
      ],
    };
    expect(validateModel(badCond).errors.join("\n")).toContain(
      "toggle: cond expression must have exactly 3 args",
    );

    const badEffects: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: { kind: "choose", var: "flag", among: [] },
          writes: ["flag"],
        },
        {
          ...firstTransition(model),
          id: "badDequeue",
          effect: { kind: "dequeue", index: -1 },
          reads: [],
          writes: ["sys:pending"],
        },
        {
          ...firstTransition(model),
          id: "badUpdate",
          effect: {
            kind: "assign",
            var: "flag",
            expr: {
              kind: "updateField",
              target: { kind: "read", var: "flag" },
              path: [],
              value: { kind: "lit", value: true },
            },
          },
          reads: ["flag"],
          writes: ["flag"],
        },
      ],
    };
    const errors = validateModel(badEffects).errors.join("\n");
    expect(errors).toContain("toggle: choose must have at least one option");
    expect(errors).toContain(
      "badDequeue: dequeue index must be a non-negative integer",
    );
    expect(errors).toContain("badUpdate: updateField path must not be empty");
  });

  it("rejects undeclared writes and unknown vars", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      transitions: [{ ...firstTransition(model), writes: ["missing"] }],
    };
    const errors = validateModel(broken).errors.join("\n");
    expect(errors).toContain("unknown var missing");
    expect(errors).toContain("effect writes flag");
  });

  it("rejects invalid structured write values and targets", () => {
    const model = baseModel();
    const badLiteral: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "lit", value: "yes" },
          },
        },
      ],
    };
    expect(validateModel(badLiteral).errors.join("\n")).toContain(
      "invalid assignment to flag",
    );

    const badHavoc: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: { kind: "havoc", var: "missing" },
          writes: ["flag"],
        },
      ],
    };
    expect(validateModel(badHavoc).errors.join("\n")).toContain(
      "havoc targets unknown var missing",
    );

    const badFreshTarget: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "freshToken", domainOf: "mode" },
          },
        },
      ],
    };
    expect(validateModel(badFreshTarget).errors.join("\n")).toContain(
      "freshToken assignment to flag requires a tokens target",
    );

    const badFreshDomain: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "assign",
            var: "mode",
            expr: { kind: "freshToken", domainOf: "flag" },
          },
        },
      ],
    };
    expect(validateModel(badFreshDomain).errors.join("\n")).toContain(
      "freshToken domainOf flag must reference a tokens var",
    );

    const missingFreshDomain: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "assign",
            var: "mode",
            expr: { kind: "freshToken", domainOf: "missing" },
          },
        },
      ],
    };
    expect(validateModel(missingFreshDomain).errors.join("\n")).toContain(
      "freshToken domainOf references unknown var missing",
    );
  });

  it("rejects structurally typed expression/domain mismatches", () => {
    const model = baseModel();
    const enumGuard: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: { kind: "read", var: "mode" },
          reads: ["mode"],
        },
      ],
    };
    expect(validateModel(enumGuard).errors.join("\n")).toContain(
      "toggle: guard must be boolean but got enum(a|b)",
    );

    const literalGuard: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: { kind: "lit", value: "yes" },
          reads: [],
        },
      ],
    };
    expect(validateModel(literalGuard).errors.join("\n")).toContain(
      'toggle: guard must be boolean but got literal "yes"',
    );

    const enumAssignedToBool: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "read", var: "mode" },
          },
          reads: ["flag", "mode"],
          writes: ["flag"],
        },
      ],
    };
    expect(validateModel(enumAssignedToBool).errors.join("\n")).toContain(
      "toggle: assignment to flag expects bool but got enum(a|b)",
    );

    const badIfCondition: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "if",
            cond: { kind: "read", var: "mode" },
            // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
            then: {
              kind: "assign",
              var: "flag",
              expr: { kind: "lit", value: true },
            },
            else: {
              kind: "assign",
              var: "flag",
              expr: { kind: "lit", value: false },
            },
          },
          reads: ["flag", "mode"],
          writes: ["flag"],
        },
      ],
    };
    expect(validateModel(badIfCondition).errors.join("\n")).toContain(
      "toggle: if condition must be boolean but got enum(a|b)",
    );

    const badCondBranches: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "assign",
            var: "mode",
            expr: {
              kind: "cond",
              args: [
                { kind: "read", var: "flag" },
                { kind: "read", var: "mode" },
                { kind: "read", var: "flag" },
              ],
            },
          },
          reads: ["flag", "mode"],
          writes: ["mode"],
        },
      ],
    };
    expect(validateModel(badCondBranches).errors.join("\n")).toContain(
      "toggle: cond branches have incompatible domains enum(a|b) and bool",
    );

    const recordModel: Model = {
      ...model,
      vars: [
        ...model.vars,
        {
          id: "box",
          domain: { kind: "record", fields: { flag: bool } },
          origin: "system",
          scope: { kind: "global" },
          initial: { flag: false },
        },
      ],
      transitions: [
        {
          ...firstTransition(model),
          effect: {
            kind: "assign",
            var: "box",
            expr: {
              kind: "updateField",
              target: { kind: "read", var: "box" },
              path: ["flag"],
              value: { kind: "read", var: "mode" },
            },
          },
          reads: ["flag", "box", "mode"],
          writes: ["box"],
        },
      ],
    };
    expect(validateModel(recordModel).errors.join("\n")).toContain(
      "toggle: updateField flag expects bool but got enum(a|b)",
    );
  });

  it("rejects malformed tagged domains", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      vars: [
        ...model.vars,
        {
          id: "badTagged",
          domain: { kind: "tagged", tag: "kind", variants: { x: bool } },
          origin: "system",
          scope: { kind: "global" },
          initial: { kind: "x" },
        },
      ],
    };
    const result = validateModel(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "badTagged: tagged variant x must be a record domain",
    );
  });

  it("rejects enum and tagged values referenced outside their domains", () => {
    const model = baseModel();
    const brokenEnum: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          guard: {
            kind: "eq",
            args: [
              { kind: "read", var: "mode" },
              { kind: "lit", value: "c" },
            ],
          },
        },
      ],
    };
    expect(validateModel(brokenEnum).errors.join("\n")).toContain(
      "mode references invalid enum value c",
    );

    const taggedModel: Model = {
      ...model,
      vars: [
        ...model.vars,
        {
          id: "session",
          domain: {
            kind: "tagged",
            tag: "kind",
            variants: {
              guest: { kind: "record", fields: {} },
              user: { kind: "record", fields: {} },
            },
          },
          origin: "system",
          scope: { kind: "global" },
          initial: { kind: "guest" },
        },
      ],
      transitions: [
        {
          ...firstTransition(model),
          guard: {
            kind: "tagIs",
            arg: { kind: "read", var: "session" },
            tag: "admin",
          },
          reads: [...firstTransition(model).reads, "session"],
        },
      ],
    };
    expect(validateModel(taggedModel).errors.join("\n")).toContain(
      "session references invalid tag admin",
    );
  });

  it("rejects invalid internal triggeredBy dependencies", () => {
    const model = baseModel();
    const unknownDependency: Model = {
      ...model,
      transitions: [
        {
          ...firstTransition(model),
          id: "effectWithMissingDependency",
          cls: "internal",
          label: { kind: "internal", text: "effect" },
          triggeredBy: ["missing"],
        },
      ],
    };
    expect(validateModel(unknownDependency).errors.join("\n")).toContain(
      "effectWithMissingDependency: triggeredBy references unknown var missing",
    );

    const nonInternal: Model = {
      ...model,
      transitions: [{ ...firstTransition(model), triggeredBy: ["flag"] }],
    };
    expect(validateModel(nonInternal).errors.join("\n")).toContain(
      "toggle: triggeredBy is only valid on internal transitions",
    );
  });

  it("validates pending queue roles and effect queue resolution", () => {
    const pendingOpDomain = {
      kind: "boundedList" as const,
      inner: {
        kind: "record" as const,
        fields: {
          opId: { kind: "enum" as const, values: ["op"] },
          continuation: { kind: "enum" as const, values: ["cont"] },
          args: { kind: "record" as const, fields: {} },
        },
      },
      maxLen: 1,
    };
    const routeVars = baseModel().vars.filter(
      (decl) => decl.id === "sys:route" || decl.id === "sys:history",
    );
    const implicitQueueModel: Model = {
      ...baseModel(),
      vars: [
        ...routeVars,
        {
          id: "app:asyncQueue",
          domain: pendingOpDomain,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
        ...baseModel().vars.filter((decl) =>
          ["flag", "mode"].includes(decl.id),
        ),
      ],
      transitions: [
        {
          id: "enqueueOp",
          cls: "user",
          label: { kind: "click", text: "Enqueue" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "enqueue",
            op: "op",
            continuation: "cont",
            args: {},
          },
          reads: [],
          writes: ["app:asyncQueue"],
          confidence: "exact",
        },
      ],
    };
    expect(validateModel(implicitQueueModel).ok).toBe(true);

    const explicitQueueModel: Model = {
      ...implicitQueueModel,
      transitions: [
        {
          ...implicitQueueModel.transitions[0]!,
          effect: {
            kind: "enqueue",
            queue: "app:asyncQueue",
            op: "op",
            continuation: "cont",
            args: {},
          },
        },
      ],
    };
    expect(validateModel(explicitQueueModel).ok).toBe(true);

    const ambiguousQueues: Model = {
      ...implicitQueueModel,
      vars: [
        ...routeVars,
        {
          id: "app:pendingA",
          domain: pendingOpDomain,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
        {
          id: "app:pendingB",
          domain: pendingOpDomain,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
      ],
    };
    expect(validateModel(ambiguousQueues).errors.join("\n")).toContain(
      "enqueueOp: enqueue/dequeue queue is ambiguous",
    );

    const noQueueRole: Model = {
      ...baseModel(),
      transitions: [
        {
          id: "enqueueOp",
          cls: "user",
          label: { kind: "click", text: "Enqueue" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "enqueue",
            op: "op",
            continuation: "cont",
            args: {},
          },
          reads: [],
          writes: ["sys:pending"],
          confidence: "exact",
        },
      ],
    };
    noQueueRole.vars = noQueueRole.vars.map((decl) =>
      decl.id === "sys:pending" ? { ...decl, role: undefined } : decl,
    );
    expect(validateModel(noQueueRole).errors.join("\n")).toContain(
      "enqueueOp: enqueue/dequeue requires a pending-queue role var",
    );

    const badShape: Model = {
      ...implicitQueueModel,
      vars: implicitQueueModel.vars.map((decl) =>
        decl.id === "app:asyncQueue"
          ? {
              ...decl,
              domain: {
                ...pendingOpDomain,
                inner: {
                  kind: "record" as const,
                  fields: {
                    opId: { kind: "enum" as const, values: ["op"] },
                    continuation: { kind: "enum" as const, values: ["cont"] },
                  },
                },
              },
            }
          : decl,
      ),
    };
    expect(validateModel(badShape).errors.join("\n")).toContain(
      "app:asyncQueue item domain missing args",
    );

    const badMaxLen: Model = {
      ...implicitQueueModel,
      bounds: { ...implicitQueueModel.bounds, maxPending: 2 },
    };
    expect(validateModel(badMaxLen).errors.join("\n")).toContain(
      "app:asyncQueue maxLen must match bounds.maxPending",
    );
  });
});

describe("property DSL", () => {
  it("infers simple state reads for property slicing metadata", () => {
    const model = baseModel();
    expect(
      always(
        model,
        and(eq(readVar("flag"), lit(false)), eq(readVar("mode"), lit("a"))),
        {
          name: "flagMode",
        },
      ).reads,
    ).toEqual(["flag", "mode"]);
    expect(
      alwaysStep(
        model,
        {
          negate: true,
          step: stepEnqueued("op"),
          pre: eq(readVar("flag"), lit(true)),
        },
        { name: "stepReads" },
      ).reads,
    ).toEqual(["flag"]);
    expect(
      reachableFrom(
        model,
        eq(readVar("mode"), lit("a")),
        eq(readVar("flag"), lit(true)),
        { name: "fromReads" },
      ).reads,
    ).toEqual(["flag", "mode"]);
  });

  it("preserves explicit read metadata over inferred reads", () => {
    const model = baseModel();
    expect(
      always(model, eq(readVar("flag"), lit(false)), {
        name: "explicitReads",
        reads: ["mode"],
      }).reads,
    ).toEqual(["mode"]);
  });

  it("allows slicing eligibility without explicit reads when predicate is walkable", () => {
    const model = baseModel();
    expect(
      canSliceProperty(model, {
        kind: "always",
        name: "flagFalse",
        predicate: eq(readVar("flag"), lit(false)),
      }),
    ).toBe(true);
  });

  it("records literal enabled transition references for slicing", () => {
    const model = baseModel();
    const property = always(model, not(enabled("toggle")), {
      name: "toggleUnavailable",
      reads: [],
    });
    expect(property.enabledTransitions).toEqual(["toggle"]);
  });

  it("builds changed-var step predicate helpers", () => {
    expect(stepChanged("app:location")).toEqual({ changed: "app:location" });
    expect(stepChangedTo("app:location", "/checkout")).toEqual({
      changedTo: { var: "app:location", value: "/checkout" },
    });
  });

  it("does not infer route reads for transitionEnabled without route dependency", () => {
    const model: Model = {
      ...baseModel(),
      vars: [
        ...baseModel().vars.filter((decl) => decl.id !== "sys:route"),
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "toggle",
          cls: "user",
          label: { kind: "click", text: "Toggle" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "lit", value: true },
          },
          reads: ["flag"],
          writes: ["flag"],
          confidence: "exact",
        },
      ],
    };
    const property = always(model, enabled("toggle"), {
      name: "toggleEnabled",
    });
    expect(property.reads).toEqual([]);
    expect(property.enabledTransitions).toEqual(["toggle"]);
  });

  it("infers only guard reads for enabled with a wide effect and narrow guard", () => {
    const model: Model = {
      ...baseModel(),
      vars: [
        ...baseModel().vars.filter(
          (decl) => !["flag", "mode"].includes(decl.id),
        ),
        {
          id: "guard",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "widePayload",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "effectRead",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "wideEffect",
          cls: "user",
          label: { kind: "click", text: "Wide effect" },
          source: [],
          guard: eq(readVar("guard"), lit(true)),
          effect: {
            kind: "assign",
            var: "widePayload",
            expr: { kind: "read", var: "effectRead" },
          },
          reads: ["guard", "effectRead", "widePayload"],
          writes: ["widePayload"],
          confidence: "exact",
        },
      ],
    };
    const property = always(model, enabled("wideEffect"), {
      name: "wideEnabled",
    });
    expect(property.reads).toEqual(["guard"]);
    expect(property.enabledTransitions).toEqual(["wideEffect"]);
  });

  it("infers sorted guard-read union for enabledTransitionPrefix", () => {
    const model: Model = {
      ...baseModel(),
      vars: [
        ...baseModel().vars.filter(
          (decl) => !["flag", "mode"].includes(decl.id),
        ),
        {
          id: "guardA",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "guardB",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "family.alpha",
          cls: "user",
          label: { kind: "click", text: "Alpha" },
          source: [],
          guard: eq(readVar("guardA"), lit(true)),
          effect: {
            kind: "assign",
            var: "guardB",
            expr: { kind: "lit", value: true },
          },
          reads: ["guardA", "guardB"],
          writes: ["guardB"],
          confidence: "exact",
        },
        {
          id: "family.beta",
          cls: "user",
          label: { kind: "click", text: "Beta" },
          source: [],
          guard: eq(readVar("guardB"), lit(true)),
          effect: {
            kind: "assign",
            var: "guardA",
            expr: { kind: "lit", value: true },
          },
          reads: ["guardA", "guardB"],
          writes: ["guardA"],
          confidence: "exact",
        },
      ],
    };
    const property = always(model, enabledTransitionPrefix("family."), {
      name: "familyEnabled",
    });
    expect(property.reads).toEqual(["guardA", "guardB"]);
    expect(property.enabledTransitions).toEqual([
      "family.alpha",
      "family.beta",
    ]);
  });

  it("emits transitionEnabledPrefix IR for suffixed transition families", () => {
    const model = baseModel();
    expect(enabledTransitionPrefix("LaneTimer.onClick.draftSec")).toEqual({
      kind: "transitionEnabledPrefix",
      prefix: "LaneTimer.onClick.draftSec",
    });
  });

  it("infers enabledTransitions for every transition matching a prefix", () => {
    const model: Model = {
      ...baseModel(),
      transitions: [
        {
          id: "LaneTimer.onClick.draftSec.gpspae",
          cls: "user",
          label: { kind: "click", text: "+10秒" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "lit", value: true },
          },
          reads: ["flag"],
          writes: ["flag"],
          confidence: "exact",
        },
        {
          id: "LaneTimer.onClick.draftSec.1sxiol",
          cls: "user",
          label: { kind: "click", text: "reset" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "lit", value: false },
          },
          reads: ["flag"],
          writes: ["flag"],
          confidence: "exact",
        },
      ],
    };
    const property = always(
      model,
      enabledTransitionPrefix("LaneTimer.onClick.draftSec"),
      { name: "resetFamilyEnabled" },
    );
    expect(property.enabledTransitions).toEqual([
      "LaneTimer.onClick.draftSec.1sxiol",
      "LaneTimer.onClick.draftSec.gpspae",
    ]);
  });

  it("allows explicit enabled transition metadata when inference cannot see through helpers", () => {
    const model = baseModel();
    const toggleEnabled = enabled("toggle");
    const property = always(model, not(toggleEnabled), {
      name: "toggleUnavailable",
      reads: [],
      enabledTransitions: ["toggle"],
    });
    expect(property.enabledTransitions).toEqual(["toggle"]);
  });
});

describe("evalStatePredicate", () => {
  it("matches tagIs against the tagged discriminant field", () => {
    expect(
      evalStatePredicate(
        { kind: "tagIs", arg: readVar("session"), tag: "admin" },
        { session: { kind: "admin" } },
      ),
    ).toBe(true);
    expect(
      evalStatePredicate(
        { kind: "tagIs", arg: readVar("session"), tag: "admin" },
        { session: { kind: "guest", role: "admin" } },
      ),
    ).toBe(false);
  });

  it("rejects step-only expressions in plain state predicates", () => {
    expect(() =>
      evalStatePredicate({ kind: "readPre", var: "flag" }, { flag: true }),
    ).toThrow(/readPre is only valid in step predicates/);
    expect(() =>
      evalStatePredicate({ kind: "readOpArg", key: "plan" }, {}),
    ).toThrow(/readOpArg is only valid in step predicates/);
    expect(() =>
      evalStatePredicate(
        { kind: "transitionEnabled", transitionId: "toggle" },
        {},
      ),
    ).toThrow(/transitionEnabled is only valid in step predicates/);
    expect(() =>
      evalStatePredicate(
        {
          kind: "transitionEnabledPrefix",
          prefix: "LaneTimer.onClick.draftSec",
        },
        {},
      ),
    ).toThrow(/transitionEnabledPrefix is only valid in step predicates/);
  });
});
