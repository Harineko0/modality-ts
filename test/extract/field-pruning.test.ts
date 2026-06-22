import {
  buildFieldPruningMetadata,
  collectExprReadFieldPaths,
  type Model,
  projectRecordDomainForSlice,
  readVar,
} from "modality-ts/core";
import { describe, expect, it } from "vitest";

function sessionModel(transitions: Model["transitions"]): Model {
  return {
    schemaVersion: 1,
    id: "field-pruning-fixture",
    bounds: { maxDepth: 4, maxPending: 2, maxInternalSteps: 4 },
    vars: [
      {
        id: "session",
        domain: {
          kind: "record",
          fields: {
            user: {
              kind: "record",
              fields: {
                id: { kind: "tokens", count: 1 },
                avatarUrl: { kind: "tokens", count: 1 },
              },
            },
          },
        },
        origin: { file: "fixture.ts", line: 1 },
        scope: { kind: "global" },
        initial: {
          user: { id: "u1", avatarUrl: "" },
        },
      },
    ],
    transitions,
  };
}

describe("field pruning metadata", () => {
  it("keeps read nested paths and prunes unrelated record fields", () => {
    const model = sessionModel([
      {
        id: "check-id",
        cls: "user",
        label: { kind: "click" },
        source: [{ file: "fixture.ts", line: 10 }],
        guard: {
          kind: "eq",
          args: [
            readVar("session", ["user", "id"]),
            { kind: "lit", value: "blocked" },
          ],
        },
        effect: {
          kind: "assign",
          var: "session",
          expr: {
            kind: "lit",
            value: { user: { id: "u2", avatarUrl: "" } },
          },
        },
        reads: ["session"],
        writes: ["session"],
        confidence: "exact",
      },
    ]);

    expect(buildFieldPruningMetadata(model).entries).toEqual([
      {
        varId: "session",
        keptPaths: [["user", "id"]],
        prunedPaths: [["user", "avatarUrl"]],
        reason: "unread",
        source: { file: "fixture.ts", line: 10 },
        confidence: "over-approx",
      },
    ]);
  });

  it("collects nested read paths from structured expressions", () => {
    const paths = collectExprReadFieldPaths(
      readVar("session", ["user", "id"]),
      "session",
    );
    expect(paths).toEqual([["user", "id"]]);
  });

  it("projects record domains to slice-retained field paths", () => {
    const model = sessionModel([
      {
        id: "check-id",
        cls: "user",
        label: { kind: "click" },
        source: [{ file: "fixture.ts", line: 10 }],
        guard: {
          kind: "eq",
          args: [
            readVar("session", ["user", "id"]),
            { kind: "lit", value: "blocked" },
          ],
        },
        effect: {
          kind: "assign",
          var: "session",
          expr: {
            kind: "updateField",
            target: readVar("session"),
            path: ["user", "id"],
            value: { kind: "lit", value: "u2" },
          },
        },
        reads: ["session"],
        writes: ["session"],
        confidence: "exact",
      },
    ]);
    const decl = model.vars[0]!;
    const projected = projectRecordDomainForSlice(decl, [["user", "id"]]);
    expect(projected?.domain).toEqual({
      kind: "record",
      fields: {
        user: {
          kind: "record",
          fields: {
            id: { kind: "tokens", count: 1 },
          },
        },
      },
    });
    expect(projected?.initial).toEqual({ user: { id: "u1" } });
  });
});
