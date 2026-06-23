import { checkModel } from "modality-ts/check";
import { eq, lit, type Model, readVar } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/plugins/state/use-state/transitions.js";
import { reachable } from "../helpers/property-builders.js";

function skeletonModel(
  result: ReturnType<typeof extractUseStateSkeleton>,
  pendingOps: string[] = [],
): Model {
  return {
    schemaVersion: 1,
    id: "timer-test",
    bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "sys:route",
        domain: { kind: "enum", values: ["/"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "/",
      },
      {
        id: "sys:history",
        domain: {
          kind: "boundedList",
          inner: { kind: "enum", values: ["/"] },
          maxLen: 1,
        },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "sys:pending",
        domain: {
          kind: "boundedList",
          inner: {
            kind: "record",
            fields: {
              opId: { kind: "enum", values: pendingOps },
              continuation: { kind: "record", fields: {} },
              args: { kind: "record", fields: {} },
            },
          },
          maxLen: 1,
        },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      ...result.vars,
    ],
    transitions: result.transitions,
  };
}

function timerVar(result: ReturnType<typeof extractUseStateSkeleton>): string {
  const timer = result.vars.find((decl) => decl.id.startsWith("sys:timer:"));
  if (!timer) throw new Error("expected timer var");
  return timer.id;
}

describe("timers cancellation", () => {
  it("sequences schedule and clear in handler effect order", () => {
    const scheduleOnly = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => {
          setTimeout(() => setSaveStatus('posting'), 10);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const scheduleOnlyClick = scheduleOnly.transitions.find(
      (t) => t.cls === "user",
    );
    expect(scheduleOnlyClick?.effect).toMatchObject({
      kind: "assign",
      expr: { kind: "lit", value: "scheduled" },
    });

    const scheduleClear = extractUseStateSkeleton(
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
    const click = scheduleClear.transitions.find((t) => t.cls === "user");
    expect(click?.effect).toEqual({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: expect.stringMatching(/^sys:timer:/),
          expr: { kind: "lit", value: "scheduled" },
        },
        {
          kind: "assign",
          var: expect.stringMatching(/^sys:timer:/),
          expr: { kind: "lit", value: "idle" },
        },
      ],
    });
    expect(
      scheduleClear.transitions.some((t) => t.id.includes("clearTimeout")),
    ).toBe(false);

    const intervalClear = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return <button onClick={() => {
          const h = setInterval(() => setCount(c => c + 1), 100);
          clearInterval(h);
        }}>Tick</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const intervalClick = intervalClear.transitions.find(
      (t) => t.cls === "user",
    );
    expect(intervalClick?.effect).toEqual({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: expect.stringMatching(/^sys:timer:/),
          expr: { kind: "lit", value: "scheduled" },
        },
        {
          kind: "assign",
          var: expect.stringMatching(/^sys:timer:/),
          expr: { kind: "lit", value: "idle" },
        },
      ],
    });
  });

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
  });

  it("models setInterval with clear guard", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return <button onClick={() => {
          const h = setInterval(() => setCount(c => c + 1), 100);
          clearInterval(h);
        }}>Tick</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions.some((t) => t.cls === "env")).toBe(true);
    expect(result.transitions.some((t) => t.id.includes("clearInterval"))).toBe(
      false,
    );
  });

  it("reaches scheduled timer state and disables fire after clear", () => {
    const scheduleOnly = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => {
          setTimeout(() => setSaveStatus('posting'), 10);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const scheduleTimer = timerVar(scheduleOnly);
    const scheduledReachable = checkModel(skeletonModel(scheduleOnly), [
      reachable(
        skeletonModel(scheduleOnly),
        eq(readVar(scheduleTimer), lit("scheduled")),
        { name: "timerScheduled", reads: [scheduleTimer] },
      ),
    ]);
    expect(scheduledReachable.verdicts[0]?.status).toMatch(/^verified/);

    const scheduleClear = extractUseStateSkeleton(
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
    const click = scheduleClear.transitions.find((t) => t.cls === "user");
    const clearedTimer = timerVar(scheduleClear);
    expect(click?.effect).toMatchObject({
      kind: "seq",
      effects: [
        { expr: { kind: "lit", value: "scheduled" } },
        { expr: { kind: "lit", value: "idle" } },
      ],
    });
    const fire = scheduleClear.transitions.find((t) => t.cls === "env");
    expect(fire?.guard).toEqual({
      kind: "eq",
      args: [
        { kind: "read", var: clearedTimer },
        { kind: "lit", value: "scheduled" },
      ],
    });
  });
});
