import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/sources/use-state/transitions.js";

describe("suspense", () => {
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

  it("does not gate suspense resolve transitions by boundary ready", () => {
    const result = extractUseStateSkeleton(
      `
      import { Suspense, use } from 'react';
      const promise = Promise.resolve('ok');
      function Child() {
        use(promise);
        return <button>Done</button>;
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
    const resolve = result.transitions.find(
      (t) => t.cls === "env" && t.label.kind === "resolve",
    );
    expect(resolve?.guard?.kind).toBe("eq");
    if (resolve?.guard?.kind === "eq") {
      expect(resolve.guard.args[0]).toMatchObject({
        kind: "read",
        var: "sys:pending",
        path: ["0", "opId"],
      });
    }
    expect(resolve?.reads ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^sys:suspense:/)]),
    );
  });

  it("does not globally gate unrelated transitions by the last boundary", () => {
    const result = extractUseStateSkeleton(
      `
      import { Suspense, useState } from 'react';
      function Child() {
        const [open, setOpen] = useState(false);
        return <button onClick={() => setOpen(true)}>Open</button>;
      }
      export function App() {
        const [first, setFirst] = useState(false);
        const [second, setSecond] = useState(false);
        return (
          <>
            <button onClick={() => setFirst(true)}>First</button>
            <Suspense fallback={<button>Wait</button>}>
              <Child />
            </Suspense>
            <button onClick={() => setSecond(true)}>Second</button>
          </>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const second = result.transitions.find(
      (t) => t.cls === "user" && t.writes.includes("local:App.second"),
    );
    expect(second?.guard).toEqual({ kind: "lit", value: true });
    const first = result.transitions.find(
      (t) => t.cls === "user" && t.writes.includes("local:App.first"),
    );
    expect(first?.guard).toEqual({ kind: "lit", value: true });
  });
});
