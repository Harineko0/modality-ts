import { describe, expect, it } from "vitest";
import { always, reachable } from "../helpers/property-builders.js";
import {
  and,
  eq,
  evalStatePredicate,
  lit,
  neq,
  or,
  readVar,
  StatePredicateEvalError,
  type Model,
} from "modality-ts/core";
import {
  assertObservableInvariantsOrThrow,
  assertObservableState,
  assertObservableStateOrThrow,
  createModalityAssertions,
  evaluateObservableInvariants,
  observable,
} from "modality-ts/cli/runtime";

const model = {} as Model;

describe("modality-ts/cli/runtime observable assertions", () => {
  it("compares observable app values against a model state", () => {
    const result = assertObservableState(
      { "local:App.status": "idle", "swr:todos:data": "many" },
      [
        observable("local:App.status", (app: { status: string }) => app.status),
        observable("swr:todos:data", (app: { todos: string }) => app.todos),
      ],
      { status: "idle", todos: "0" },
    );
    expect(result).toEqual({
      ok: false,
      mismatches: [{ var: "swr:todos:data", expected: "many", actual: "0" }],
    });
  });

  it("throws a compact divergence message for replay codegen", () => {
    expect(() =>
      assertObservableStateOrThrow(
        { flag: true },
        [observable("flag", (app: { flag: boolean }) => app.flag)],
        { flag: false },
      ),
    ).toThrow("flag expected=true actual=false");
  });

  it("evaluates observable-only invariants against live app state", () => {
    const properties = [
      always(
        model,
        or(
          eq(readVar("auth"), lit("user")),
          neq(readVar("route"), lit("/checkout")),
        ),
        { name: "checkoutRequiresUser", reads: ["auth", "route"] },
      ),
      always(model, eq(readVar("missing"), lit(true)), {
        name: "missingObservable",
        reads: ["missing"],
      }),
      reachable(model, eq(readVar("auth"), lit("user")), {
        name: "notAnInvariant",
        reads: ["auth"],
      }),
    ];
    const result = evaluateObservableInvariants(
      properties,
      [
        observable("auth", (app: { auth: string; route: string }) => app.auth),
        observable(
          "route",
          (app: { auth: string; route: string }) => app.route,
        ),
      ],
      { auth: "guest", route: "/checkout" },
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      {
        property: "checkoutRequiresUser",
        message: "observable invariant failed",
      },
    ]);
    expect(result.skipped).toEqual([
      { property: "missingObservable", reason: "unobservable reads: missing" },
      {
        property: "notAnInvariant",
        reason:
          "unsupported property kind for runtime assertion: temporal (formula: EF)",
      },
    ]);
  });

  it("throws compact observable invariant failures", () => {
    expect(() =>
      assertObservableInvariantsOrThrow(
        [
          always(model, eq(readVar("flag"), lit(true)), {
            name: "flagTrue",
            reads: ["flag"],
          }),
        ],
        [observable("flag", (app: { flag: boolean }) => app.flag)],
        { flag: false },
      ),
    ).toThrow("flagTrue: observable invariant failed");
  });

  it("skips predicates that touch unobserved vars at runtime", () => {
    const result = evaluateObservableInvariants(
      [
        always(
          model,
          and(
            eq(readVar("flag"), lit(true)),
            eq(readVar("secret"), lit("open")),
          ),
          { name: "secretOpen", reads: ["flag"] },
        ),
      ],
      [observable("flag", (app: { flag: boolean }) => app.flag)],
      { flag: true },
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([]);
    expect(result.skipped).toEqual([
      { property: "secretOpen", reason: "unobservable reads: secret" },
    ]);
  });

  it("subscribes to observable state changes and reports invariant results", () => {
    let snapshot = { auth: "guest", route: "/" };
    const listeners = new Set<() => void>();
    const results: boolean[] = [];
    const violations: string[] = [];
    const controller = createModalityAssertions(
      [
        always(
          model,
          or(
            eq(readVar("auth"), lit("user")),
            neq(readVar("route"), lit("/checkout")),
          ),
          { name: "checkoutRequiresUser", reads: ["auth", "route"] },
        ),
      ],
      [
        observable("auth", (app: typeof snapshot) => app.auth),
        observable("route", (app: typeof snapshot) => app.route),
      ],
      {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      {
        onResult: ({ result }) => results.push(result.ok),
        onViolation: ({ result }) =>
          violations.push(result.violations[0]?.property ?? "unknown"),
      },
    );

    const stop = controller.start();
    snapshot = { auth: "guest", route: "/checkout" };
    for (const listener of listeners) listener();
    stop();
    snapshot = { auth: "user", route: "/checkout" };
    for (const listener of listeners) listener();

    expect(results).toEqual([true, false]);
    expect(violations).toEqual(["checkoutRequiresUser"]);
  });

  it("can throw on subscribed runtime assertion violations", () => {
    const controller = createModalityAssertions(
      [
        always(model, eq(readVar("flag"), lit(true)), {
          name: "flagTrue",
          reads: ["flag"],
        }),
      ],
      [observable("flag", (app: { flag: boolean }) => app.flag)],
      {
        getSnapshot: () => ({ flag: false }),
        subscribe: () => () => {},
      },
      { throwOnViolation: true },
    );
    expect(() => controller.check()).toThrow(
      "flagTrue: observable invariant failed",
    );
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
    ).toThrow(StatePredicateEvalError);
    expect(() =>
      evalStatePredicate({ kind: "readOpArg", key: "plan" }, {}),
    ).toThrow(/step predicates/);
    expect(() =>
      evalStatePredicate(
        { kind: "transitionEnabled", transitionId: "toggle" },
        {},
      ),
    ).toThrow(/step predicates/);
  });
});
