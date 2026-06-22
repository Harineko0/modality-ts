import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/sources/use-state/transitions.js";

describe("effect phase ordering", () => {
  it("assigns phase 0 to layout and phase 1 to passive effects", () => {
    const result = extractUseStateSkeleton(
      `
      import { useEffect, useLayoutEffect, useState } from 'react';
      export function App() {
        const [open, setOpen] = useState(false);
        useLayoutEffect(() => { setOpen(true); }, [open]);
        useEffect(() => { setOpen(false); }, [open]);
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const layout = result.transitions.find((t) =>
      t.id.includes("useLayoutEffect"),
    );
    const passive = result.transitions.find((t) => t.id.includes("useEffect"));
    expect(layout?.phase).toBe(0);
    expect(passive?.phase).toBe(1);
    expect(layout?.triggeredBy).toEqual(["local:App.open"]);
    expect(passive?.triggeredBy).toEqual(["local:App.open"]);
  });

  it("extracts useTransition isPending var and deferred commit", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState, useTransition } from 'react';
      export function App() {
        const [step, setStep] = useState(0);
        const [isPending, startTransition] = useTransition();
        return <button onClick={() => startTransition(() => setStep(2))}>Next</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.vars.some((decl) => decl.id.includes("isPending"))).toBe(
      true,
    );
    const click = result.transitions.find((t) => t.cls === "user");
    expect(click?.label).toMatchObject({ kind: "click" });
    expect(click?.effect).toMatchObject({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: expect.stringMatching(/isPending/),
          expr: { kind: "lit", value: true },
        },
        { kind: "enqueue" },
      ],
    });
    const resolve = result.transitions.find(
      (t) => t.cls === "env" && t.label.kind === "resolve",
    );
    expect(resolve?.writes).toEqual(
      expect.arrayContaining([
        "sys:pending",
        expect.stringMatching(/isPending/),
        "local:App.step",
      ]),
    );
  });
});
