import { describe, expect, it } from "vitest";
import { extractReactSourceTransitions } from "../../src/extract/lang/ts/driver/react-source-transitions.js";

function hasEnqueueFor(
  result: ReturnType<typeof extractReactSourceTransitions>,
  op: string,
): boolean {
  return result.transitions.some(
    (transition) =>
      transition.cls === "user" &&
      JSON.stringify(transition.effect).includes('"enqueue"') &&
      JSON.stringify(transition.effect).includes(op),
  );
}

describe("handler effect indirection", () => {
  it("extracts an awaited local helper wrapping a mutation alias", () => {
    const result = extractReactSourceTransitions(
      `
        function ConfirmationModal(props: { onConfirm: () => void }) {
          return <button onClick={props.onConfirm} />;
        }

        function RestartServerButton() {
          const projectRef = "project";
          const { mutate: restartProject } = useProjectRestartMutation();
          const requestProjectRestart = () => {
            restartProject({ ref: projectRef });
          };
          return (
            <ConfirmationModal
              onConfirm={async () => {
                await requestProjectRestart();
              }}
            />
          );
        }
      `,
      {
        fileName: "RestartServerButton.tsx",
        effectApis: ["useProjectRestartMutation"],
        asyncOutcomes: {
          useProjectRestartMutation: { success: true, error: false },
        },
      },
    );

    expect(hasEnqueueFor(result, "useProjectRestartMutation")).toBe(true);
    expect(
      result.transitions.some(
        (transition) =>
          transition.cls === "env" &&
          transition.label.kind === "resolve" &&
          transition.label.op === "useProjectRestartMutation" &&
          transition.label.outcome === "success",
      ),
    ).toBe(true);
    expect(
      result.transitions.some(
        (transition) =>
          transition.cls === "env" &&
          transition.label.kind === "resolve" &&
          transition.label.op === "useProjectRestartMutation" &&
          transition.label.outcome === "error",
      ),
    ).toBe(true);
  });

  it("extracts a callback-style local helper wrapping a mutation alias", () => {
    const result = extractReactSourceTransitions(
      `
        function App() {
          const { mutate: restartProject } = useProjectRestartMutation();
          const req = () => {
            restartProject({ ref: "project" });
          };
          return <button onClick={() => { req(); }} />;
        }
      `,
      {
        fileName: "App.tsx",
        effectApis: ["useProjectRestartMutation"],
      },
    );

    expect(hasEnqueueFor(result, "useProjectRestartMutation")).toBe(true);
  });

  it("extracts helper-reached useState writes through the existing summary path", () => {
    const result = extractReactSourceTransitions(
      `
        import { useState } from "react";

        function App() {
          const [status, setStatus] = useState<"idle" | "done">("idle");
          const markDone = () => {
            setStatus("done");
          };
          return <button onClick={() => { markDone(); }} />;
        }
      `,
      { fileName: "App.tsx" },
    );

    const statusVar = result.vars.find((variable) =>
      variable.id.includes("status"),
    );
    expect(statusVar).toBeDefined();
    expect(
      result.transitions.some(
        (transition) =>
          statusVar &&
          transition.writes.includes(statusVar.id) &&
          JSON.stringify(transition.effect).includes('"done"'),
      ),
    ).toBe(true);
  });

  it("does not inline imported helper calls", () => {
    const result = extractReactSourceTransitions(
      `
        import { requestProjectRestart } from "./helpers";

        function App() {
          return (
            <button
              onClick={async () => {
                await requestProjectRestart();
              }}
            />
          );
        }
      `,
      {
        fileName: "App.tsx",
        effectApis: ["useProjectRestartMutation"],
      },
    );

    expect(hasEnqueueFor(result, "useProjectRestartMutation")).toBe(false);
  });
});
