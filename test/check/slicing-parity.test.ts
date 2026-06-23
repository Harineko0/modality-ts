import {
  checkModel,
  sliceModel,
  sliceModelForCheckProperty,
} from "modality-ts/check";
import {
  collectRecordDomainFieldPaths,
  domainCardinality,
  enabled,
  enabledTransitionPrefix,
  eq,
  lit,
  type Model,
  neq,
  not,
  or,
  type Property,
  readVar,
  stepChangedTo,
  stepEnqueued,
  stepTransitionId,
  validateModel,
} from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { compareModelEconomics } from "../../src/check/slicing/contributors.js";
import { propertySlicingSkipReason } from "../../src/check/slicing/slice-model.js";
import { buildPropertySlicePlan } from "../../src/cli/features/extract/command.js";
import { routeMountScope } from "../../src/extract/lang/ts/driver/routes.js";
import { always, alwaysStep, reachable } from "../helpers/property-builders.js";

const bool = { kind: "bool" } as const;
const twoRoutes = { kind: "enum", values: ["/a", "/b"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} },
  },
} as const;

function read(id: string) {
  return { kind: "read" as const, var: id };
}

function mountScope(route: string) {
  return {
    kind: "mount-local" as const,
    id: `route:${route}`,
    when: {
      kind: "eq" as const,
      args: [read("app:location"), lit(route)],
    },
  };
}

function wideProductDomain() {
  const fields: Record<string, { kind: "bool" }> = {};
  for (let index = 0; index < 32; index += 1) {
    fields[`flag${index}`] = { kind: "bool" };
  }
  return { kind: "record" as const, fields };
}

describe("enabled transition guard-only slicing", () => {
  it("retains guard reads but not transition writes or effect reads", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-guard-only",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "status",
          domain: {
            kind: "enum",
            values: ["connected", "disconnected", "error"],
          },
          origin: "system",
          scope: { kind: "global" },
          initial: "disconnected",
        },
        {
          id: "widePayload",
          domain: wideProductDomain(),
          origin: "system",
          scope: { kind: "global" },
          initial: Object.fromEntries(
            Array.from({ length: 32 }, (_, index) => [`flag${index}`, false]),
          ),
        },
        {
          id: "unrelated",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "sys:pending",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
      ],
      transitions: [
        {
          id: "setDensity1",
          cls: "user",
          label: { kind: "click", text: "Set density 1" },
          source: [],
          guard: { kind: "eq", args: [read("status"), lit("connected")] },
          effect: {
            kind: "assign",
            var: "widePayload",
            expr: {
              kind: "updateField",
              target: read("widePayload"),
              path: ["flag0"],
              value: lit(true),
            },
          },
          reads: ["status", "widePayload", "unrelated"],
          writes: ["widePayload"],
          confidence: "exact",
        },
      ],
    };
    const property = always(
      m,
      or(neq(readVar("status"), lit("connected")), enabled("setDensity1")),
      { name: "densityGuardedByConnection" },
    );
    const { model: sliced } = sliceModelForCheckProperty(m, property);
    const varIds = sliced.vars.map((decl) => decl.id);
    expect(varIds).toContain("status");
    expect(varIds).not.toEqual(
      expect.arrayContaining(["widePayload", "unrelated", "sys:pending"]),
    );
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "setDensity1",
    ]);
    expect(sliced.transitions[0]?.writes).toEqual([]);
    expect(sliced.transitions[0]?.effect).toEqual({
      kind: "seq",
      effects: [],
    });
  });

  it("matches unsliced verdict status for enabled property with inferred reads", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-guard-verdict-parity",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "status",
          domain: {
            kind: "enum",
            values: ["connected", "disconnected", "error"],
          },
          origin: "system",
          scope: { kind: "global" },
          initial: "disconnected",
        },
        {
          id: "widePayload",
          domain: wideProductDomain(),
          origin: "system",
          scope: { kind: "global" },
          initial: Object.fromEntries(
            Array.from({ length: 32 }, (_, index) => [`flag${index}`, false]),
          ),
        },
        {
          id: "sys:pending",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
      ],
      transitions: [
        {
          id: "setDensity1",
          cls: "user",
          label: { kind: "click", text: "Set density 1" },
          source: [],
          guard: { kind: "eq", args: [read("status"), lit("connected")] },
          effect: {
            kind: "assign",
            var: "widePayload",
            expr: {
              kind: "updateField",
              target: read("widePayload"),
              path: ["flag0"],
              value: lit(true),
            },
          },
          reads: ["status", "widePayload"],
          writes: ["widePayload"],
          confidence: "exact",
        },
      ],
    };
    const property = always(
      m,
      or(neq(readVar("status"), lit("connected")), enabled("setDensity1")),
      { name: "densityGuardedByConnectionVerdictParity" },
    );
    const unsliced = checkModel(m, [property]);
    const sliced = checkModel(m, [property], { slicing: true });
    expect(unsliced.verdicts[0]?.status).toBe("verified");
    expect(sliced.verdicts[0]?.status).toBe("verified");
  });

  it("prunes mount-local writes for enabled observation of a mount-local transition", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-mount-local-observation",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
        {
          id: "status",
          domain: { kind: "enum", values: ["connected", "disconnected"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "disconnected",
        },
        {
          id: "local:a.wide",
          domain: wideProductDomain(),
          origin: "system",
          scope: routeMountScope("/a"),
          initial: Object.fromEntries(
            Array.from({ length: 32 }, (_, index) => [`flag${index}`, false]),
          ),
        },
      ],
      transitions: [
        {
          id: "setWide",
          cls: "user",
          label: { kind: "click", text: "Set wide" },
          source: [],
          guard: {
            kind: "and",
            args: [
              { kind: "eq", args: [read("sys:route"), lit("/a")] },
              { kind: "eq", args: [read("status"), lit("connected")] },
            ],
          },
          effect: {
            kind: "assign",
            var: "local:a.wide",
            expr: {
              kind: "updateField",
              target: read("local:a.wide"),
              path: ["flag0"],
              value: lit(true),
            },
          },
          reads: ["sys:route", "status", "local:a.wide"],
          writes: ["local:a.wide"],
          confidence: "exact",
        },
      ],
    };
    const property = always(
      m,
      or(neq(readVar("status"), lit("connected")), enabled("setWide")),
      { name: "wideGuardedByConnection" },
    );
    const { model: sliced } = sliceModelForCheckProperty(m, property);
    const varIds = sliced.vars.map((decl) => decl.id);
    expect(varIds).toContain("status");
    expect(varIds).toContain("sys:route");
    expect(varIds).not.toContain("local:a.wide");
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "setWide",
    ]);
    expect(sliced.transitions[0]?.reads).toEqual(["status", "sys:route"]);
    expect(sliced.transitions[0]?.writes).toEqual([]);
    expect(sliced.transitions[0]?.effect).toEqual({
      kind: "seq",
      effects: [],
    });
  });

  it("prunes transition writes for prefix-enabled predicates", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-prefix-guard-only",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "status",
          domain: { kind: "enum", values: ["ready", "busy"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "ready",
        },
        {
          id: "widePayload",
          domain: wideProductDomain(),
          origin: "system",
          scope: { kind: "global" },
          initial: Object.fromEntries(
            Array.from({ length: 32 }, (_, index) => [`flag${index}`, false]),
          ),
        },
      ],
      transitions: [
        {
          id: "LaneTimer.onClick.draftSec.aaa",
          cls: "user",
          label: { kind: "click", text: "+1" },
          source: [],
          guard: { kind: "eq", args: [read("status"), lit("ready")] },
          effect: { kind: "assign", var: "widePayload", expr: lit(true) },
          reads: ["status", "widePayload"],
          writes: ["widePayload"],
          confidence: "exact",
        },
        {
          id: "LaneTimer.onClick.draftSec.bbb",
          cls: "user",
          label: { kind: "click", text: "+2" },
          source: [],
          guard: { kind: "eq", args: [read("status"), lit("ready")] },
          effect: { kind: "assign", var: "widePayload", expr: lit(false) },
          reads: ["status", "widePayload"],
          writes: ["widePayload"],
          confidence: "exact",
        },
      ],
    };
    const property = always(
      m,
      enabledTransitionPrefix("LaneTimer.onClick.draftSec"),
      {
        name: "prefixEnabled",
        reads: ["status"],
      },
    );
    const { model: sliced } = sliceModelForCheckProperty(m, property);
    const varIds = sliced.vars.map((decl) => decl.id);
    expect(varIds).toContain("status");
    expect(varIds).not.toContain("widePayload");
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "LaneTimer.onClick.draftSec.aaa",
      "LaneTimer.onClick.draftSec.bbb",
    ]);
    expect(
      sliced.transitions.every(
        (transition) =>
          transition.writes.length === 0 &&
          transition.effect.kind === "seq" &&
          transition.effect.effects.length === 0,
      ),
    ).toBe(true);
  });

  it("prunes wide co-writes pulled in by a needed writer transition (Coffee DX shape)", () => {
    // A mount effect co-writes the property-relevant `printerStatus` together
    // with a wide payload and density vars. The density onClick is decomposed
    // into seq.1..seq.3. The property only reads `printerStatus` and observes
    // enabledness of seq.1, so cone-of-influence projection must prune the wide
    // payload and the sibling density transitions, not retain them via the
    // effect's co-writes.
    const densities = [1, 2, 3];
    const m: Model = {
      schemaVersion: 1,
      id: "coffee-cowrite",
      bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 6 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/home", "/other"] },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/home",
        },
        {
          id: "printerStatus",
          domain: { kind: "enum", values: ["connected", "disconnected"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "disconnected",
        },
        {
          id: "printerStatusData",
          domain: {
            kind: "record",
            fields: Object.fromEntries(
              Array.from({ length: 5 }, (_, index) => [`flag${index}`, bool]),
            ),
          },
          origin: "system",
          scope: { kind: "global" },
          initial: Object.fromEntries(
            Array.from({ length: 5 }, (_, index) => [`flag${index}`, false]),
          ),
        },
        ...densities.map((v) => ({
          id: `optimisticDensity${v}`,
          domain: bool,
          origin: "system" as const,
          scope: { kind: "global" as const },
          initial: false,
        })),
      ],
      transitions: [
        {
          id: "CustomerHome.useEffect",
          cls: "internal",
          label: { kind: "internal", text: "mount effect" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "seq",
            effects: [
              { kind: "havoc", var: "printerStatus" },
              { kind: "havoc", var: "printerStatusData" },
              ...densities.map((v) => ({
                kind: "assign" as const,
                var: `optimisticDensity${v}`,
                expr: lit(false),
              })),
            ],
          },
          reads: [],
          writes: [
            "printerStatus",
            "printerStatusData",
            ...densities.map((v) => `optimisticDensity${v}`),
          ],
          triggeredBy: ["sys:route"],
          confidence: "exact",
        },
        ...densities.map((v) => ({
          id: `PrinterSettingsDialog.onClick.optimisticDensity.seq.${v}`,
          cls: "user" as const,
          label: { kind: "click" as const, text: `density ${v}` },
          source: [],
          guard: {
            kind: "eq" as const,
            args: [read("printerStatus"), lit("connected")],
          },
          effect: {
            kind: "seq" as const,
            effects: [
              {
                kind: "assign" as const,
                var: `optimisticDensity${v}`,
                expr: lit(true),
              },
              { kind: "havoc" as const, var: "printerStatusData" },
            ],
          },
          reads: [
            "printerStatus",
            `optimisticDensity${v}`,
            "printerStatusData",
          ],
          writes: [`optimisticDensity${v}`, "printerStatusData"],
          confidence: "exact" as const,
        })),
      ],
    };
    const property = always(
      m,
      or(
        neq(readVar("printerStatus"), lit("connected")),
        enabled("PrinterSettingsDialog.onClick.optimisticDensity.seq.1"),
      ),
      { name: "densityOneRequiresConnectedPrinter" },
    );
    const { model: sliced } = sliceModelForCheckProperty(m, property);
    const varIds = sliced.vars.map((decl) => decl.id);
    // The wide payload and the density co-writes are pruned: nothing the
    // property observes reads them.
    expect(varIds).not.toContain("printerStatusData");
    expect(varIds).not.toContain("optimisticDensity2");
    expect(varIds).not.toContain("optimisticDensity3");
    expect(varIds.sort()).toEqual(["printerStatus", "sys:route"]);
    // Sibling density transitions become no-ops once their writes are pruned
    // and drop out; only the observed seq.1 remains (observation-only).
    expect(sliced.transitions.map((transition) => transition.id)).not.toContain(
      "PrinterSettingsDialog.onClick.optimisticDensity.seq.2",
    );
    expect(
      sliced.transitions.find(
        (transition) =>
          transition.id ===
          "PrinterSettingsDialog.onClick.optimisticDensity.seq.1",
      )?.effect,
    ).toEqual({ kind: "seq", effects: [] });
    // Verdict parity with the full model is preserved.
    const unsliced = checkModel(m, [property]);
    const slicedRun = checkModel(m, [property], { slicing: true });
    expect(slicedRun.verdicts[0]?.status).toBe(unsliced.verdicts[0]?.status);
  });
});

describe("neutral slicing parity", () => {
  it("includes changed and changedTo vars from step facts", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "changed-facts",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "app:location",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
        {
          id: "draft",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
      ],
      transitions: [
        {
          id: "mark",
          cls: "user",
          label: { kind: "click", text: "Mark" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "draft", expr: lit("nonEmpty") },
          reads: ["draft"],
          writes: ["draft"],
          confidence: "exact",
        },
      ],
    };
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: {
          ...stepTransitionId("mark"),
          ...stepChangedTo("draft", "nonEmpty"),
        },
        post: eq(readVar("app:location"), lit("/a")),
      },
      { name: "markChangedDraft", reads: ["app:location"] },
    );
    const sliced = sliceModelForCheckProperty(m, property).model;
    expect(sliced.vars.map((decl) => decl.id)).toContain("draft");
  });

  it("includes pending queue role vars for step facts", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "pending-role-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "app:asyncQueue",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
        {
          id: "draft",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
      ],
      transitions: [
        {
          id: "submit",
          cls: "user",
          label: { kind: "submit", text: "Submit" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "enqueue",
            queue: "app:asyncQueue",
            op: "POST",
            continuation: "submit#1",
            args: {},
          },
          reads: [],
          writes: ["app:asyncQueue"],
          confidence: "exact",
        },
      ],
    };
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: { ...stepTransitionId("submit"), ...stepEnqueued("POST") },
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      { name: "submitEnqueue", reads: ["draft"] },
    );
    const sliced = sliceModelForCheckProperty(m, property).model;
    expect(sliced.vars.map((decl) => decl.id)).toContain("app:asyncQueue");
  });

  it("prunes sibling route-local vars sharing the same mount guard", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-sibling-prune",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
        {
          id: "local:a.flag",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
        {
          id: "local:a.noise",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
        {
          id: "local:a.wide",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
        {
          id: "sys:pending",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
      ],
      transitions: [
        {
          id: "setFlag",
          cls: "user",
          label: { kind: "click", text: "Set flag" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "local:a.flag", expr: lit(true) },
          reads: ["local:a.flag"],
          writes: ["local:a.flag"],
          confidence: "exact",
        },
        {
          id: "setNoise",
          cls: "user",
          label: { kind: "click", text: "Set noise" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "local:a.noise", expr: lit(true) },
          reads: ["local:a.noise"],
          writes: ["local:a.noise"],
          confidence: "exact",
        },
        {
          id: "submit",
          cls: "user",
          label: { kind: "submit", text: "Submit" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "enqueue",
            queue: "sys:pending",
            op: "POST",
            continuation: "submit#1",
            args: {},
          },
          reads: [],
          writes: ["sys:pending"],
          confidence: "exact",
        },
      ],
    };
    const { model: sliced, diagnostics } = sliceModelForCheckProperty(
      m,
      always(m, eq(readVar("local:a.flag"), lit(true)), {
        name: "flagSet",
        reads: ["local:a.flag"],
      }),
    );
    const varIds = sliced.vars.map((decl) => decl.id);
    expect(varIds).toEqual(
      expect.arrayContaining(["local:a.flag", "sys:route"]),
    );
    expect(varIds).not.toEqual(
      expect.arrayContaining(["local:a.noise", "local:a.wide", "sys:pending"]),
    );
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "setFlag",
    ]);
    expect(
      sliced.transitions.every(
        (transition) => transition.effect.kind !== "enqueue",
      ),
    ).toBe(true);
    expect(diagnostics?.mountScopeDependencies).toEqual([
      {
        varId: "local:a.flag",
        guardReads: ["sys:route"],
        retainedBecause: ["property-read"],
      },
    ]);
  });

  it("includes mount guard vars for touched mount-local vars", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "mount-guard-slice",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "app:location",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
        {
          id: "local:panel",
          domain: bool,
          origin: "system",
          scope: mountScope("/a"),
          initial: false,
        },
      ],
      transitions: [],
    };
    const sliced = sliceModel(m, ["local:panel"]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining(["local:panel", "app:location"]),
    );
  });

  it("does not pull route vars for transitionEnabled without route dependency", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-no-location",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "app:location",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
      ],
      transitions: [
        {
          id: "toggle",
          cls: "user",
          label: { kind: "click", text: "Toggle" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "flag", expr: lit(true) },
          reads: ["flag"],
          writes: ["flag"],
          confidence: "exact",
        },
      ],
    };
    const property = always(m, not(enabled("toggle")), {
      name: "toggleUnavailable",
      reads: [],
    });
    const sliced = sliceModel(m, property.reads ?? []);
    expect(sliced.vars.map((decl) => decl.id)).not.toContain("app:location");
  });

  it("drops unrelated tree cache and environment vars from slices", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "noise-vars",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "needed",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "sys:tree",
          domain: { kind: "enum", values: ["cold", "warm"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "cold",
        },
        {
          id: "sys:cache",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "sys:environment",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "writer",
          cls: "user",
          label: { kind: "click", text: "Write" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "needed", expr: lit(true) },
          reads: ["needed"],
          writes: ["needed"],
          confidence: "exact",
        },
      ],
    };
    const sliced = sliceModel(m, ["needed"]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(["needed"]);
    expect(sliced.vars.map((decl) => decl.id)).not.toEqual(
      expect.arrayContaining(["sys:tree", "sys:cache", "sys:environment"]),
    );
  });

  it("checks commit ordinal internal stabilization without route-specific vars", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "commit-ordinal",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: true,
        },
        {
          id: "value",
          domain: { kind: "enum", values: ["none", "a", "b"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "none",
        },
      ],
      transitions: [
        {
          id: "internal:setA",
          cls: "internal",
          label: { kind: "internal", text: "set a" },
          source: [],
          guard: {
            kind: "and",
            args: [
              read("flag"),
              { kind: "eq", args: [read("value"), lit("none")] },
            ],
          },
          effect: { kind: "assign", var: "value", expr: lit("a") },
          reads: ["flag", "value"],
          writes: ["value"],
          phase: 0,
          confidence: "exact",
        },
        {
          id: "internal:setB",
          cls: "internal",
          label: { kind: "internal", text: "set b" },
          source: [],
          guard: {
            kind: "and",
            args: [
              read("flag"),
              { kind: "eq", args: [read("value"), lit("none")] },
            ],
          },
          effect: { kind: "assign", var: "value", expr: lit("b") },
          reads: ["flag", "value"],
          writes: ["value"],
          phase: 1,
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, eq(readVar("value"), lit("a")), {
        name: "ordinalA",
        reads: ["value"],
      }),
    ]);
    expect(result.verdicts[0]?.status).toMatch(/^verified/);
    const sliced = sliceModel(m, ["value"]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining(["flag", "value"]),
    );
  });
});

describe("record field domain projection", () => {
  function wideRecordFixtureModel(): Model {
    const fields: Record<string, { kind: "bool" }> = {};
    for (let index = 0; index < 32; index += 1) {
      fields[`flag${index}`] = { kind: "bool" };
    }
    const domain = { kind: "record" as const, fields };
    return {
      schemaVersion: 1,
      id: "record-field-projection",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "product",
          domain,
          origin: "system",
          scope: { kind: "global" },
          initial: Object.fromEntries(
            Array.from({ length: 32 }, (_, index) => [`flag${index}`, false]),
          ),
        },
        {
          id: "noise",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "setFlag0",
          cls: "user",
          label: { kind: "click", text: "Set flag0" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "assign",
            var: "product",
            expr: {
              kind: "updateField",
              target: read("product"),
              path: ["flag0"],
              value: lit(true),
            },
          },
          reads: ["product"],
          writes: ["product"],
          confidence: "exact",
        },
        {
          id: "setNoise",
          cls: "user",
          label: { kind: "click", text: "Set noise" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "noise", expr: lit(true) },
          reads: ["noise"],
          writes: ["noise"],
          confidence: "exact",
        },
      ],
    };
  }

  it("projects retained record domains to property-relevant field paths", () => {
    const model = wideRecordFixtureModel();
    const property = reachable(
      model,
      eq(readVar("product", ["flag0"]), lit(true)),
      { name: "flag0True", reads: ["product"] },
    );
    const fullDecl = model.vars.find((decl) => decl.id === "product")!;
    const fullBits = Math.log2(domainCardinality(fullDecl.domain));
    const { model: sliced } = sliceModelForCheckProperty(model, property);
    const productDecl = sliced.vars.find((decl) => decl.id === "product")!;
    expect(collectRecordDomainFieldPaths(productDecl.domain)).toEqual([
      ["flag0"],
    ]);
    const economics = compareModelEconomics(model, sliced);
    expect(economics.retainedBits).toBeLessThan(fullBits);
    expect(economics.topContributors[0]?.prunedFieldPaths?.length).toBe(31);
    expect(validateModel(sliced, { sliced: true }).ok).toBe(true);
  });

  it("matches unsliced verdict status after record domain projection", () => {
    const model = wideRecordFixtureModel();
    const property = reachable(
      model,
      eq(readVar("product", ["flag0"]), lit(true)),
      { name: "flag0TrueParity", reads: ["product"] },
    );
    const _unsliced = checkModel(model, [property]);
    const sliced = checkModel(model, [property], { slicing: true });
    expect(sliced.verdicts[0]?.status).toBe("verified");
  });

  it("records projected economics in extract-side slice manifests", () => {
    const model = wideRecordFixtureModel();
    const property = reachable(
      model,
      eq(readVar("product", ["flag0"]), lit(true)),
      { name: "flag0TrueManifest", reads: ["product"] },
    );
    const checkSlice = sliceModelForCheckProperty(model, property).model;
    const plan = buildPropertySlicePlan(
      model,
      [property],
      "model.model.json",
      "model.slices.json",
      new Date("2026-06-19T00:00:00.000Z"),
    );
    const entry = plan.manifest.properties[0];
    expect(entry?.status).toBe("emitted");
    if (entry?.status === "emitted") {
      expect(entry.varIds).toEqual(
        checkSlice.vars.map((decl) => decl.id).sort(),
      );
      expect(entry.retainedBits).toBeLessThan(32);
      expect(entry.topRetainedContributors[0]?.prunedFieldPaths?.length).toBe(
        31,
      );
    }
  });
});

describe("directional predicate not(eq) normalization", () => {
  it("treats not(eq(...)) like neq for reachable directional closure", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "not-eq-directional",
      bounds: { maxDepth: 3, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "phase",
          domain: { kind: "enum", values: ["menu", "confirm", "complete"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "menu",
        },
        {
          id: "noise",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "toConfirm",
          cls: "user",
          label: { kind: "click", text: "Confirm" },
          source: [],
          guard: eq(read("phase"), lit("menu")),
          effect: { kind: "assign", var: "phase", expr: lit("confirm") },
          reads: ["phase"],
          writes: ["phase"],
          confidence: "exact",
        },
        {
          id: "setNoise",
          cls: "user",
          label: { kind: "click", text: "Noise" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "noise", expr: lit(true) },
          reads: ["noise"],
          writes: ["noise"],
          confidence: "exact",
        },
      ],
    };
    const property = reachable(
      model,
      not(eq(readVar("phase"), lit("confirm"))),
      { name: "notConfirm", reads: ["phase"] },
    );
    const { model: sliced, diagnostics } = sliceModelForCheckProperty(
      model,
      property,
    );
    expect(diagnostics?.closureFallback).toBeUndefined();
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(["phase"]);
    expect(
      sliceModelForCheckProperty(
        model,
        reachable(model, eq(readVar("phase"), lit("confirm")), {
          name: "confirm",
          reads: ["phase"],
        }),
      )
        .model.transitions.map((transition) => transition.id)
        .sort(),
    ).toEqual(["toConfirm"]);
  });
});

describe("extract-side property slice parity", () => {
  it("matches check-side slice ids for a state property", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "slice-parity",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "noise",
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
          label: { kind: "click" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "flag",
            expr: { kind: "not", args: [{ kind: "read", var: "flag" }] },
          },
          reads: ["flag"],
          writes: ["flag"],
          confidence: "exact",
        },
        {
          id: "noiseToggle",
          cls: "user",
          label: { kind: "click" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "noise",
            expr: { kind: "not", args: [{ kind: "read", var: "noise" }] },
          },
          reads: ["noise"],
          writes: ["noise"],
          confidence: "exact",
        },
      ],
    };
    const property = reachable(model, eq(readVar("flag"), lit(true)), {
      name: "flagTrue",
      reads: ["flag"],
    });
    const checkSlice = sliceModelForCheckProperty(model, property).model;
    const plan = buildPropertySlicePlan(
      model,
      [property],
      "model.model.json",
      "model.slices.json",
      new Date("2026-06-19T00:00:00.000Z"),
    );
    const entry = plan.manifest.properties[0];
    expect(entry?.status).toBe("emitted");
    if (entry?.status === "emitted") {
      expect(entry.varIds).toEqual(
        checkSlice.vars.map((decl) => decl.id).sort(),
      );
      expect(entry.transitionIds).toEqual(
        checkSlice.transitions.map((transition) => transition.id).sort(),
      );
    }
  });

  it("records skipped opaque properties without emitting slice models", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "slice-parity-opaque",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [],
    };
    const property = {
      kind: "temporal",
      name: "opaque",
      formula: { kind: "atom", predicate: { step: { changed: "flag" } } },
    } as unknown as Property;
    const skipReason = propertySlicingSkipReason(model, property);
    expect(skipReason).toBeDefined();
    const plan = buildPropertySlicePlan(
      model,
      [property],
      "model.model.json",
      "model.slices.json",
      new Date("2026-06-19T00:00:00.000Z"),
    );
    expect(plan.emittedWrites).toEqual([]);
    expect(plan.manifest.properties).toEqual([
      {
        property: "opaque",
        propertyIndex: 0,
        status: "skipped",
        reason: skipReason,
      },
    ]);
  });
});

describe("sliced plus POR parity", () => {
  function toggleModel(): Model {
    return {
      schemaVersion: 1,
      id: "slice-por-toggle",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: twoRoutes, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
        {
          id: "a",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "b",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "flipA",
          cls: "user",
          label: { kind: "click", text: "A" },
          source: [],
          guard: { kind: "not", args: [{ kind: "read", var: "a" }] },
          effect: { kind: "assign", var: "a", expr: lit(true) },
          reads: ["a"],
          writes: ["a"],
          confidence: "exact",
        },
        {
          id: "flipB",
          cls: "user",
          label: { kind: "click", text: "B" },
          source: [],
          guard: { kind: "not", args: [{ kind: "read", var: "b" }] },
          effect: { kind: "assign", var: "b", expr: lit(true) },
          reads: ["b"],
          writes: ["b"],
          confidence: "exact",
        },
      ],
    };
  }

  it("matches sliced verdict status with sliced plus POR", () => {
    const model = toggleModel();
    const properties = [always(model, lit(true), { name: "ok", reads: [] })];
    const sliced = checkModel(model, properties, { slicing: true });
    const slicedPor = checkModel(model, properties, {
      slicing: true,
      partialOrderReduction: true,
    });
    expect(slicedPor.verdicts.map((verdict) => verdict.status)).toEqual(
      sliced.verdicts.map((verdict) => verdict.status),
    );
    expect(slicedPor.diagnostics?.partialOrderReduction?.enabled).toBe(false);
  });
});
