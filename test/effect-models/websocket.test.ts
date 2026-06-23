import { websocketEffectPlugin } from "modality-ts/extract/plugins/effect/websocket";
import { reactRouterAdapter } from "modality-ts/extract/plugins/route/router";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractReactSourceTransitions } from "../../src/extract/engine/ts/react-source-transitions.js";

describe("websocket effect model provider", () => {
  const provider = websocketEffectPlugin();

  it("recognizeEffect returns identical connect enqueue IR", () => {
    const source = ts.createSourceFile(
      "Socket.tsx",
      `
      export default function Feed() {
        const socket = new WebSocket("wss://example.test/feed");
        return null;
      }
      `,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const fn = source.statements[0] as ts.FunctionDeclaration;
    const decl = fn.body!.statements[0] as ts.VariableStatement;
    const ctor = decl.declarationList.declarations[0]!
      .initializer as ts.NewExpression;
    const webSocketRegistrations: import("modality-ts/extract/engine/ts/transition/environment-callbacks.js").WebSocketRegistration[] =
      [];
    const recognized = provider.recognizeEffect(ctor, {
      component: "Feed",
      source,
      fileName: "Socket.tsx",
      setters: new Map(),
      timerContext: "Feed.useEffect",
      webSocketIndex: { value: 0 },
      webSocketBindings: new Map(),
      webSocketRegistrations,
      environment: {
        webSockets: [{ url: "wss://example.test/feed", messages: ["tick"] }],
      },
    });
    expect(recognized?.model.channel).toBe("websocket");
    expect(recognized?.scheduleSummary.effect).toEqual({
      kind: "assign",
      var: "sys:websocket:Feed.Feed.useEffect.wss_example_test_feed#0",
      expr: { kind: "lit", value: "connecting" },
    });
    expect(webSocketRegistrations).toHaveLength(1);
  });

  it("matches full extraction websocket CPS lowering", () => {
    const routePlugin = reactRouterAdapter();
    const result = extractReactSourceTransitions(
      `
      import { useEffect } from 'react';
      export default function Feed() {
        useEffect(() => {
          const socket = new WebSocket("wss://example.test/feed");
          socket.onmessage = () => {};
          return () => socket.close();
        }, []);
        return null;
      }
      `,
      {
        route: "/",
        fileName: "Feed.tsx",
        routePlugin,
        environment: {
          webSockets: [{ url: "wss://example.test/feed", messages: ["tick"] }],
        },
      },
    );
    expect(
      result.vars.some((decl) =>
        decl.id.startsWith("sys:websocket:Feed.Feed.useEffect"),
      ),
    ).toBe(true);
    expect(
      result.transitions.some((transition) => transition.cls === "env"),
    ).toBe(true);
  });
});
