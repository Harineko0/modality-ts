import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/plugins/state/use-state/transitions.js";

describe("layout effects", () => {
  it("extracts useLayoutEffect with phase 0", () => {
    const result = extractUseStateSkeleton(
      `
      import { useLayoutEffect, useState } from 'react';
      export function App() {
        const [open, setOpen] = useState(false);
        useLayoutEffect(() => {
          setOpen(true);
        }, [open]);
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const transition = result.transitions.find((candidate) =>
      candidate.id.startsWith("App.useLayoutEffect"),
    );
    expect(transition).toMatchObject({
      cls: "internal",
      phase: 0,
      triggeredBy: ["local:App.open"],
      writes: ["local:App.open"],
    });
  });
});

describe("batching snapshot", () => {
  it("models functional updater reads with read", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return <button onClick={() => { setCount(p => p); setCount(p => p); }}>Inc</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const click = result.transitions.find((t) => t.cls === "user");
    expect(click?.effect).toMatchObject({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          expr: { kind: "read", var: "local:App.count" },
        },
        {
          kind: "assign",
          expr: { kind: "read", var: "local:App.count" },
        },
      ],
    });
  });
});

describe("timers cancellation", () => {
  it("guards timer fire on scheduled state", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => {
          const h = setTimeout(() => setSaveStatus('posting'), 10);
          clearTimeout(h);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const fire = result.transitions.find((t) => t.cls === "env");
    expect(fire?.guard).toEqual({
      kind: "eq",
      args: [
        { kind: "read", var: expect.stringMatching(/^sys:timer:/) },
        { kind: "lit", value: "scheduled" },
      ],
    });
    expect(result.transitions.some((t) => t.id.includes("clearTimeout"))).toBe(
      false,
    );
  });
});
