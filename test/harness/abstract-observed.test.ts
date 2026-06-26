import {
  abstractObservedState,
  abstractObservedValue,
  ObservableActionReplayDriver,
  observationSource,
  replayTrace,
} from "modality-ts/cli/harness";
import type { AbstractDomain, Trace } from "modality-ts/core";
import { describe, expect, it } from "vitest";

describe("abstract observed state", () => {
  it("abstracts primitive and numeric domains without hiding enum misses", () => {
    expect(abstractObservedValue({ kind: "bool" }, 1)).toBe(true);
    expect(
      abstractObservedValue({ kind: "enum", values: ["idle", "done"] }, "done"),
    ).toBe("done");
    expect(
      abstractObservedValue({ kind: "enum", values: ["idle", "done"] }, "bad"),
    ).toBe("bad");
    expect(
      abstractObservedValue(
        { kind: "boundedInt", min: 0, max: 3, overflow: "saturate" },
        9,
      ),
    ).toBe(3);
    expect(
      abstractObservedValue({ kind: "intSet", values: [0, 5, 10] }, 7),
    ).toBe(5);
  });

  it("abstracts option, token, record, tagged, list, and length domains", () => {
    expect(
      abstractObservedValue(
        { kind: "option", inner: { kind: "tokens", count: 1 } },
        { id: "u1" },
      ),
    ).toBe("tok1");
    expect(
      abstractObservedValue(
        { kind: "option", inner: { kind: "tokens", count: 1 } },
        null,
      ),
    ).toBeNull();
    expect(abstractObservedValue({ kind: "lengthCat" }, ["a", "b"])).toBe(
      "many",
    );
    expect(
      abstractObservedValue(
        {
          kind: "record",
          fields: {
            count: { kind: "boundedInt", min: 0, max: 2 },
            data: { kind: "tokens", count: 1, names: ["tokA"] },
          },
        },
        { count: 7, data: { id: 1 }, extra: true },
      ),
    ).toEqual({ count: 2, data: "tokA" });
    expect(
      abstractObservedValue(
        {
          kind: "tagged",
          tag: "kind",
          variants: {
            ok: {
              kind: "record",
              fields: { payload: { kind: "tokens", count: 1 } },
            },
          },
        },
        { kind: "ok", payload: { id: 1 } },
      ),
    ).toEqual({ kind: "ok", payload: "tok1" });
    expect(
      abstractObservedValue(
        { kind: "boundedList", inner: { kind: "lengthCat" }, maxLen: 2 },
        ["", ["x"], ["x", "y"]],
      ),
    ).toEqual(["0", "1"]);
  });

  it("abstracts an observed state by variable id", () => {
    const domains = new Map<string, AbstractDomain>([
      ["retryCount", { kind: "tokens", count: 1, names: ["tok1"] }],
      ["riskScore", { kind: "boundedInt", min: 0, max: 10 }],
    ]);

    expect(
      abstractObservedState(domains, {
        retryCount: 3,
        riskScore: 15,
        untouched: "raw",
      }),
    ).toEqual({ retryCount: "tok1", riskScore: 10, untouched: "raw" });
  });

  it("lets observable action replay compare observed runtime values in model domains", async () => {
    let retryCount = 0;
    const trace: Trace = {
      steps: [
        {
          transitionId: "retry",
          label: {
            kind: "click",
            locator: { kind: "role", role: "button", name: "Retry" },
          },
          pre: { retryCount: "tok1" },
          post: { retryCount: "tok1" },
          diff: {},
        },
      ],
    };

    const verdict = await replayTrace(
      trace,
      new ObservableActionReplayDriver(
        {
          click: () => {
            retryCount += 1;
          },
        },
        ["retryCount"],
        [
          observationSource("store", (varId) =>
            varId === "retryCount" ? { value: retryCount } : "unobservable",
          ),
        ],
        new Map([["retryCount", { kind: "tokens", count: 1 }]]),
      ),
    );

    expect(verdict).toEqual({ status: "reproduced", stepsRun: 1 });
  });
});
