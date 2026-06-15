import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/sources/use-state/transitions.js";

describe("stale closure snapshot", () => {
  it("snapshots continuation reads with readOpArg", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={async () => {
          await api.saveTodo();
          setSaveStatus(saveStatus);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.saveTodo"] },
    );
    const success = result.transitions.find((t) => t.id.endsWith(".success"));
    expect(success?.effect).toMatchObject({
      kind: "seq",
      effects: [
        { kind: "dequeue", index: 0 },
        {
          kind: "assign",
          var: "local:App.saveStatus",
          expr: { kind: "readOpArg", key: "snap:local:App.saveStatus" },
        },
      ],
    });
  });
});
