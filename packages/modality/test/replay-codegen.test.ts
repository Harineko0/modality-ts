import { describe, expect, it } from "vitest";
import type { Trace } from "@modality/kernel";
import { generateAbstractReplayTest, generateActionReplayTest } from "../src/codegen/replay-test.js";

describe("generateAbstractReplayTest", () => {
  it("emits a deterministic abstract replay vitest file", () => {
    const trace: Trace = {
      steps: [
        {
          transitionId: "setFlag",
          label: { kind: "click", text: "Set flag" },
          pre: { flag: false },
          post: { flag: true },
          diff: { flag: { before: false, after: true } }
        }
      ]
    };
    const artifact = generateAbstractReplayTest("flag starts false", trace, [{ flag: false }, { flag: true }]);
    expect(artifact.fileName).toBe("flag_starts_false.replay.test.ts");
    expect(artifact.source).toContain('describe("replay flag starts false"');
    expect(artifact.source).toContain('expect(verdict.status).toBe("reproduced");');
    expect(artifact.source).toContain('"transitionId":"setFlag"');
  });

  it("emits an action replay vitest scaffold for concrete labels", () => {
    const trace: Trace = {
      steps: [
        {
          transitionId: "edit",
          label: { kind: "input", locator: { kind: "testId", value: "draft" }, valueClass: "nonEmpty" },
          pre: { draft: "empty" },
          post: { draft: "nonEmpty" },
          diff: { draft: { before: "empty", after: "nonEmpty" } }
        }
      ]
    };
    const artifact = generateActionReplayTest("draft can change", trace);
    expect(artifact.fileName).toBe("draft_can_change.action.replay.test.ts");
    expect(artifact.source).toContain("ActionReplayDriver");
    expect(artifact.source).toContain('"locator":{"kind":"testId","value":"draft"}');
    expect(artifact.source).toContain('"valueClass":"nonEmpty"');
  });
});
