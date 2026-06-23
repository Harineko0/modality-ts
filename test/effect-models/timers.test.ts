import { timerEffectPlugin } from "modality-ts/extract/plugins/effect/timers";
import { reactRouterAdapter } from "modality-ts/extract/plugins/route/router";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractReactSourceTransitions } from "../../src/extract/engine/ts/react-source-transitions.js";

describe("timer effect model provider", () => {
  const provider = timerEffectPlugin();

  it("recognizeEffect returns identical schedule and resolution IR", () => {
    const source = ts.createSourceFile(
      "Timer.tsx",
      `
      export default function Clock() {
        setTimeout(() => setTick(1), 100);
      }
      `,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const fn = source.statements[0] as ts.FunctionDeclaration;
    const call = (fn.body!.statements[0] as ts.ExpressionStatement)
      .expression as ts.CallExpression;
    const setters = new Map([
      [
        "setTick",
        {
          varId: "local:Clock.tick",
          component: "Clock",
          stateName: "setTick",
          domain: { kind: "int", min: 0, max: 1 },
          initial: 0,
        },
      ],
    ]);
    const timerRegistrations: import("modality-ts/extract/engine/ts/transition/timers.js").TimerRegistration[] =
      [];
    const envTransitions: import("modality-ts/core").Transition[] = [];
    const recognized = provider.recognizeEffect(call, {
      component: "Clock",
      source,
      fileName: "Timer.tsx",
      setters,
      timerContext: "Clock.useEffect",
      timerIndex: { value: 0 },
      timerBindings: new Map(),
      timerRegistrations,
      envTransitions,
    });
    expect(recognized?.model.channel).toBe("timer");
    expect(recognized?.scheduleSummary.effect).toEqual({
      kind: "assign",
      var: "sys:timer:Clock.Clock.useEffect.setTick#0",
      expr: { kind: "lit", value: "scheduled" },
    });
    expect(envTransitions).toHaveLength(1);
    expect(envTransitions[0]?.guard).toEqual({
      kind: "eq",
      args: [
        { kind: "read", var: "sys:timer:Clock.Clock.useEffect.setTick#0" },
        { kind: "lit", value: "scheduled" },
      ],
    });
  });

  it("matches full extraction timer CPS lowering", () => {
    const routePlugin = reactRouterAdapter();
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export default function Clock() {
        const [tick, setTick] = useState(0);
        useEffect(() => {
          const id = setTimeout(() => setTick((value) => value + 1), 100);
          return () => clearTimeout(id);
        }, []);
        return <span>{tick}</span>;
      }
      `,
      {
        route: "/",
        fileName: "Clock.tsx",
        routePlugin,
      },
    );
    expect(
      result.vars.some((decl) =>
        decl.id.startsWith("sys:timer:Clock.Clock.useEffect"),
      ),
    ).toBe(true);
    expect(
      result.transitions.some((transition) =>
        transition.id.includes("Clock.setTimeout"),
      ),
    ).toBe(true);
  });
});
