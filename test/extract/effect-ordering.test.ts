import { describe, expect, it } from "vitest";
import { extractUseStateSkeleton } from "../../src/extract/sources/use-state/transitions.js";

describe("effect ordering", () => {
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
});
