import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/plugins/state/use-state/transitions.js";

describe("render boundary gating", () => {
  it("gates only subtree transitions on boundary ready state", () => {
    const result = extractUseStateSkeleton(
      `
      import { Suspense, useState } from 'react';
      function Child() {
        const [open, setOpen] = useState(false);
        return <button onClick={() => setOpen(true)}>Open</button>;
      }
      export function App() {
        const [outside, setOutside] = useState(false);
        return (
          <>
            <button onClick={() => setOutside(true)}>Outside</button>
            <Suspense fallback={<button>Wait</button>}>
              <Child />
            </Suspense>
          </>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.vars.some((decl) => decl.id.startsWith("sys:suspense:")),
    ).toBe(true);
    const outside = result.transitions.find(
      (t) => t.cls === "user" && t.writes.includes("local:App.outside"),
    );
    const inside = result.transitions.find(
      (t) => t.cls === "user" && t.writes.includes("local:Child.open"),
    );
    expect(outside?.guard).toEqual({ kind: "lit", value: true });
    expect(inside?.guard).toMatchObject({
      kind: "eq",
      args: [
        { kind: "read", var: expect.stringMatching(/^sys:suspense:/) },
        { kind: "lit", value: "ready" },
      ],
    });
  });

  it("keeps plain Suspense boundaries initially ready", () => {
    const result = extractUseStateSkeleton(
      `
      import { Suspense, useState } from 'react';
      function Child() {
        const [open, setOpen] = useState(false);
        return <button onClick={() => setOpen(true)}>Open</button>;
      }
      export function App() {
        return (
          <Suspense fallback={<button>Wait</button>}>
            <Child />
          </Suspense>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const boundary = result.vars.find((decl) =>
      decl.id.startsWith("sys:suspense:"),
    );
    expect(boundary?.initial).toBe("ready");
    const click = result.transitions.find((t) => t.cls === "user");
    expect(click?.guard).toMatchObject({
      kind: "eq",
      args: [
        { kind: "read", var: boundary?.id },
        { kind: "lit", value: "ready" },
      ],
    });
  });
});
