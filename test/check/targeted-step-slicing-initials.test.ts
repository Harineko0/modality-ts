import {
  alwaysStep,
  eq,
  lit as coreLit,
  type Model,
  readVar,
  stepTransitionId,
} from "modality-ts/core";
import { describe, expect, it, vi } from "vitest";

const { modelInitialStatesMock } = vi.hoisted(() => ({
  modelInitialStatesMock: vi.fn(() => {
    throw new Error(
      "modelInitialStates must not be called during targeted slicing",
    );
  }),
}));

vi.mock("../../src/check/model-api.js", () => ({
  modelInitialStates: modelInitialStatesMock,
  modelSuccessors: vi.fn(),
}));

import {
  buildModelDependencyGraph,
  computeTargetedStepSliceClosure,
} from "../../src/check/slicing/dependency-graph.js";
import { sliceModelForCheckProperty } from "../../src/check/slicing/slice-model.js";

function lit(value: unknown) {
  return coreLit(value as never);
}

function read(id: string) {
  return { kind: "read" as const, var: id };
}

const draftDomain = {
  kind: "enum",
  values: ["empty", "nonEmpty"],
} as const;

function draftSubmitModel(options?: {
  draftInitial?: "empty" | "nonEmpty";
  includeNoise?: boolean;
}): Model {
  const draftInitial = options?.draftInitial ?? "empty";
  const includeNoise = options?.includeNoise ?? true;
  return {
    schemaVersion: 1,
    id: "draft-submit",
    bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "draft",
        domain: draftDomain,
        origin: "system",
        scope: { kind: "global" },
        initial: draftInitial,
      },
      ...(includeNoise
        ? [
            {
              id: "noise",
              domain: { kind: "bool" } as const,
              origin: "system" as const,
              scope: { kind: "global" as const },
              initial: false,
            },
          ]
        : []),
    ],
    transitions: [
      {
        id: "prepare",
        cls: "user",
        label: { kind: "click", text: "Prepare" },
        source: [],
        guard: eq(read("draft"), lit("empty")),
        effect: { kind: "assign", var: "draft", expr: lit("nonEmpty") },
        reads: ["draft"],
        writes: ["draft"],
        confidence: "exact",
      },
      {
        id: "submit",
        cls: "user",
        label: { kind: "submit", text: "Submit" },
        source: [],
        guard: eq(read("draft"), lit("nonEmpty")),
        effect: { kind: "assign", var: "draft", expr: lit("empty") },
        reads: ["draft"],
        writes: ["draft"],
        confidence: "exact",
      },
      ...(includeNoise
        ? [
            {
              id: "touchNoise",
              cls: "user" as const,
              label: { kind: "click" as const, text: "Touch noise" },
              source: [],
              guard: lit(true),
              effect: {
                kind: "assign" as const,
                var: "noise",
                expr: lit(true),
              },
              reads: [],
              writes: ["noise"],
              confidence: "exact" as const,
            },
          ]
        : []),
    ],
  };
}

describe("targeted step slicing declared initial guards", () => {
  it("does not call modelInitialStates for negated targeted alwaysStep", () => {
    const model = draftSubmitModel();
    const property = alwaysStep(
      model,
      {
        negate: true,
        step: stepTransitionId("submit"),
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      {
        name: "submitResetsDraft",
        reads: ["draft"],
        enabledTransitions: ["submit"],
      },
    );

    const sliced = sliceModelForCheckProperty(model, property);

    expect(modelInitialStatesMock).not.toHaveBeenCalled();
    expect(sliced.mode).toBe("targetedStep");
    expect(sliced.model.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining(["prepare", "submit"]),
    );
  });

  it("skips guard dependency expansion when declared initials enable the target guard", () => {
    const model = draftSubmitModel({ draftInitial: "nonEmpty" });
    const property = alwaysStep(
      model,
      {
        negate: true,
        step: stepTransitionId("submit"),
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      {
        name: "submitResetsDraft",
        reads: ["draft"],
        enabledTransitions: ["submit"],
      },
    );

    const sliced = sliceModelForCheckProperty(model, property);

    expect(sliced.mode).toBe("targetedStep");
    expect(sliced.model.transitions.map((transition) => transition.id)).toEqual(
      ["submit"],
    );
  });

  it("expands guard dependencies conservatively when declared-initial product exceeds cap", () => {
    const enumDomain = {
      kind: "enum",
      values: ["a", "b", "c"],
    } as const;
    const guardReadVars = Array.from({ length: 7 }, (_, index) => `v${index}`);
    const model: Model = {
      schemaVersion: 1,
      id: "large-initial-product",
      bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        ...guardReadVars.map((id) => ({
          id,
          domain: enumDomain,
          origin: "system" as const,
          scope: { kind: "global" as const },
          initial: ["a", "b", "c"] as const,
        })),
        {
          id: "draft",
          domain: draftDomain,
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
      ],
      transitions: [
        {
          id: "prepare",
          cls: "user",
          label: { kind: "click", text: "Prepare" },
          source: [],
          guard: eq(read("draft"), lit("empty")),
          effect: { kind: "assign", var: "draft", expr: lit("nonEmpty") },
          reads: ["draft"],
          writes: ["draft"],
          confidence: "exact",
        },
        {
          id: "submit",
          cls: "user",
          label: { kind: "submit", text: "Submit" },
          source: [],
          guard: {
            kind: "and",
            args: [
              eq(read("draft"), lit("nonEmpty")),
              ...guardReadVars.map((id) => eq(read(id), lit("a"))),
            ],
          },
          effect: { kind: "assign", var: "draft", expr: lit("empty") },
          reads: ["draft", ...guardReadVars],
          writes: ["draft"],
          confidence: "exact",
        },
      ],
    };
    const graph = buildModelDependencyGraph(model);
    const closure = computeTargetedStepSliceClosure(graph, {
      propertyReads: ["draft"],
      preconditionReads: [],
      postconditionReads: ["draft"],
      postMentionedVars: ["draft"],
      stepFactVars: [],
      enabledTransitionIds: ["submit"],
      targetTransitionIds: ["submit"],
    });

    expect([...closure.neededTransitions].sort()).toEqual(
      expect.arrayContaining(["prepare", "submit"]),
    );
  });
});
