import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/sources/use-state/transitions.js";

describe("concurrent rendering", () => {
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
    expect(
      result.transitions.some(
        (t) => t.cls === "internal" && t.id.includes("start"),
      ),
    ).toBe(false);
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
    expect(resolve?.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        { kind: "dequeue", index: 0 },
        {
          kind: "assign",
          var: expect.stringMatching(/isPending/),
          expr: { kind: "lit", value: false },
        },
      ]),
    });
  });

  it("extracts useDeferredValue deferred var", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState, useDeferredValue } from 'react';
      export function App() {
        const [value, setValue] = useState(0);
        const deferred = useDeferredValue(value);
        return <button onClick={() => setValue(1)}>Inc</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.vars.some((decl) => decl.id.includes("deferred:"))).toBe(
      true,
    );
  });

  it("does not emit always-enabled internal start for unanalyzable callbacks", () => {
    const result = extractUseStateSkeleton(
      `
      import { useTransition } from 'react';
      export function App() {
        const [isPending, startTransition] = useTransition();
        return <button onClick={() => startTransition(runTransition)}>Next</button>;
      }
      function runTransition() {}
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.transitions.some(
        (t) => t.cls === "internal" && t.id.includes("startTransition"),
      ),
    ).toBe(false);
    expect(
      result.transitions.some(
        (t) => t.cls === "user" && t.label.kind === "click",
      ),
    ).toBe(false);
  });
});
