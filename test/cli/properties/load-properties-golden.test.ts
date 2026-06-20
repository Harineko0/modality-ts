import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Model } from "modality-ts/core";
import { loadProperties } from "../../../src/cli/properties/load-properties.js";

const repoRoot = join(import.meta.dirname, "../../..");

const checkoutModel: Model = {
  schemaVersion: 1,
  id: "checkout-golden",
  bounds: { maxDepth: 8, maxPending: 3, maxInternalSteps: 8 },
  vars: [
    {
      id: "local:App.auth",
      domain: { kind: "enum", values: ["guest", "user"] },
      origin: { file: "App.tsx", line: 4 },
      scope: { kind: "global" },
      initial: "guest",
    },
    {
      id: "local:App.userId",
      domain: { kind: "enum", values: ["none", "u1"] },
      origin: { file: "App.tsx", line: 5 },
      scope: { kind: "global" },
      initial: "none",
    },
    {
      id: "local:App.plan",
      domain: { kind: "enum", values: ["none", "starter", "pro"] },
      origin: { file: "App.tsx", line: 6 },
      scope: { kind: "global" },
      initial: "none",
    },
    {
      id: "local:App.quoteStatus",
      domain: {
        kind: "enum",
        values: ["missing", "loading", "valid", "invalid"],
      },
      origin: { file: "App.tsx", line: 7 },
      scope: { kind: "global" },
      initial: "missing",
    },
    {
      id: "local:App.step",
      domain: {
        kind: "enum",
        values: ["plan", "billing", "review", "success"],
      },
      origin: { file: "App.tsx", line: 10 },
      scope: { kind: "global" },
      initial: "plan",
    },
    {
      id: "local:App.submitStatus",
      domain: { kind: "enum", values: ["idle", "submitting", "failed"] },
      origin: { file: "App.tsx", line: 15 },
      scope: { kind: "global" },
      initial: "idle",
    },
    {
      id: "sys:pending",
      domain: { kind: "lengthCat" },
      origin: "system",
      scope: { kind: "global" },
      initial: "0",
    },
  ],
  transitions: [],
};

describe("loadProperties golden", () => {
  it("loads migrated checkout props with inferred reads", async () => {
    const properties = await loadProperties(checkoutModel, [
      join(repoRoot, "examples/checkout-app/app.props.ts"),
    ]);
    const guestCannotReachSuccess = properties.find(
      (property) => property.name === "guestCannotReachSuccess",
    );
    expect(guestCannotReachSuccess).toMatchObject({
      kind: "temporal",
      reads: ["local:App.auth", "local:App.step"],
    });
    expect(
      guestCannotReachSuccess?.kind === "temporal"
        ? guestCannotReachSuccess.formula
        : undefined,
    ).toEqual({
      kind: "AG",
      arg: {
        kind: "atom",
        predicate: {
          kind: "not",
          args: [
            {
              kind: "and",
              args: [
                {
                  kind: "eq",
                  args: [
                    { kind: "read", var: "local:App.auth" },
                    { kind: "lit", value: "guest" },
                  ],
                },
                {
                  kind: "eq",
                  args: [
                    { kind: "read", var: "local:App.step" },
                    { kind: "lit", value: "success" },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
  });
});
