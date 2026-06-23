import type { Transition } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { extractReactSourceTransitions } from "../../src/extract/lang/ts/driver/react-source-transitions.js";

function userEnqueues(transitions: readonly Transition[], op: string) {
  return transitions.filter(
    (transition) =>
      transition.cls === "user" &&
      JSON.stringify(transition.effect).includes('"enqueue"') &&
      JSON.stringify(transition.effect).includes(op),
  );
}

function resolveTransitions(transitions: readonly Transition[], op: string) {
  return transitions.filter(
    (transition) =>
      transition.cls === "env" &&
      transition.label.kind === "resolve" &&
      transition.label.op === op,
  );
}

describe("handler branch effect extraction", () => {
  it("extracts guarded enqueue families from if/else-if branches", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [k, setK] = useState<"a" | "b">("a");
          return (
            <button
              onClick={async () => {
                if (k === "a") {
                  restartA({ key: k });
                } else if (k === "b") {
                  restartB({ key: k });
                }
              }}
            />
          );
        }
      `,
      {
        fileName: "Branch.tsx",
        effectApis: ["restartA", "restartB"],
        asyncOutcomes: {
          restartA: { success: true, error: false },
          restartB: { success: true, error: false },
        },
      },
    );

    const restartA = userEnqueues(result.transitions, "restartA");
    const restartB = userEnqueues(result.transitions, "restartB");
    expect(restartA).toHaveLength(1);
    expect(restartB).toHaveLength(1);
    expect(JSON.stringify(restartA[0]?.guard)).toContain('"a"');
    expect(JSON.stringify(restartB[0]?.guard)).toContain('"b"');
    expect(resolveTransitions(result.transitions, "restartA")).toHaveLength(2);
    expect(resolveTransitions(result.transitions, "restartB")).toHaveLength(2);
  });

  it("extracts guarded branch effects after helper inlining", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [k, setK] = useState<"a" | "b">("a");
          const helperA = () => {
            restartA({ key: k });
          };
          const helperB = () => {
            restartB({ key: k });
          };
          return (
            <button
              onClick={async () => {
                if (k === "a") {
                  await helperA();
                } else if (k === "b") {
                  await helperB();
                }
              }}
            />
          );
        }
      `,
      {
        fileName: "BranchHelpers.tsx",
        effectApis: ["restartA", "restartB"],
        asyncOutcomes: {
          restartA: { success: true, error: false },
          restartB: { success: true, error: false },
        },
      },
    );

    expect(userEnqueues(result.transitions, "restartA")).toHaveLength(1);
    expect(userEnqueues(result.transitions, "restartB")).toHaveLength(1);
  });

  it("extracts branch effects inside an inlined helper body", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [ready, setReady] = useState(false);
          const confirm = () => {
            if (ready) {
              restart({ value: ready });
            }
          };
          return <button onClick={() => confirm()} />;
        }
      `,
      {
        fileName: "BranchInsideHelper.tsx",
        effectApis: ["restart"],
        asyncOutcomes: { restart: { success: true, error: false } },
      },
    );

    const enqueue = userEnqueues(result.transitions, "restart");
    expect(enqueue).toHaveLength(1);
    expect(JSON.stringify(enqueue[0]?.guard)).toContain("ready");
  });

  it("extracts branch effects from an inlined helper with a literal argument", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [retryCount, setRetryCount] = useState(0);
          const runAction = async (action: "retry" | "noop") => {
            if (action === "retry") {
              await retryInvoice();
              setRetryCount(retryCount + 1);
              return;
            }
            if (action === "noop") {
              setRetryCount(retryCount);
            }
          };
          return <button onClick={() => runAction("retry")} />;
        }
      `,
      {
        fileName: "BranchArgHelper.tsx",
        effectApis: ["retryInvoice"],
        asyncOutcomes: { retryInvoice: { success: true, error: false } },
      },
    );

    expect(userEnqueues(result.transitions, "retryInvoice")).toHaveLength(1);
    expect(resolveTransitions(result.transitions, "retryInvoice")).toHaveLength(
      2,
    );
  });

  it("keeps branch-local useState writes on the existing conditional path", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [status, setStatus] = useState<"idle" | "a" | "b">("idle");
          const [k, setK] = useState<"a" | "b">("a");
          return (
            <button
              onClick={() => {
                if (k === "a") {
                  setStatus("a");
                } else {
                  setStatus("b");
                }
              }}
            />
          );
        }
      `,
      { fileName: "BranchSetters.tsx" },
    );

    const status = result.vars.find((variable) =>
      variable.id.includes("status"),
    );
    expect(status).toBeDefined();
    const writes = result.transitions.filter(
      (transition) =>
        transition.cls === "user" &&
        status &&
        transition.writes.includes(status.id),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.effect.kind).toBe("if");
    expect(JSON.stringify(writes[0]?.effect)).toContain('"a"');
    expect(JSON.stringify(writes[0]?.effect)).toContain('"b"');
  });

  it("keeps distinct guarded starts when two branches enqueue the same op", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [k, setK] = useState<"a" | "b">("a");
          return (
            <button
              onClick={() => {
                if (k === "a") {
                  restart({ key: "a" });
                } else {
                  restart({ key: "b" });
                }
              }}
            />
          );
        }
      `,
      {
        fileName: "SameOpBranches.tsx",
        effectApis: ["restart"],
        asyncOutcomes: { restart: { success: true, error: false } },
      },
    );

    expect(userEnqueues(result.transitions, "restart")).toHaveLength(2);
    expect(resolveTransitions(result.transitions, "restart")).toHaveLength(2);
  });

  it("emits a caveat when branch path enumeration is truncated", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [k, setK] = useState<"0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8">("0");
          return (
            <button
              onClick={() => {
                if (k === "0") restart0();
                else if (k === "1") restart1();
                else if (k === "2") restart2();
                else if (k === "3") restart3();
                else if (k === "4") restart4();
                else if (k === "5") restart5();
                else if (k === "6") restart6();
                else if (k === "7") restart7();
                else if (k === "8") restart8();
              }}
            />
          );
        }
      `,
      {
        fileName: "TruncatedBranches.tsx",
        effectApis: [
          "restart0",
          "restart1",
          "restart2",
          "restart3",
          "restart4",
          "restart5",
          "restart6",
          "restart7",
          "restart8",
        ],
      },
    );

    expect(
      result.transitions.some((transition) => transition.cls === "user"),
    ).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.caveat?.reason.includes("branch-paths-truncated"),
      ),
    ).toBe(true);
  });
});
