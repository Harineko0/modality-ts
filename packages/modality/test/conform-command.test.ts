import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Trace } from "@modality/kernel";
import { runConformCommand } from "../src/conform.js";

const trace: Trace = {
  steps: [
    {
      transitionId: "login",
      label: { kind: "click", text: "Login" },
      pre: { auth: "guest" },
      post: { auth: "user" },
      diff: { auth: { before: "guest", after: "user" } }
    }
  ]
};

describe("runConformCommand", () => {
  it("classifies multiple replay walks and writes metrics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    const reportPath = join(dir, "conform-report.json");
    await writeFile(
      walksPath,
      JSON.stringify([
        { id: "ok", trace, states: [{ auth: "guest" }, { auth: "user" }] },
        { id: "diverged", trace, states: [{ auth: "guest" }, { auth: "guest" }] }
      ]),
      "utf8"
    );

    const result = await runConformCommand({ walksPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.exitCode).toBe(2);
    expect(result.lines).toEqual(["conform: total=2 reproduced=1 notReproduced=1 inconclusive=0", "passRate=0.5"]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "conform-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      metrics: { total: 2, reproduced: 1, notReproduced: 1, inconclusive: 0, passRate: 0.5 }
    });
    expect(report.walks.map((walk: { id: string; status: string }) => [walk.id, walk.status])).toEqual([
      ["ok", "reproduced"],
      ["diverged", "not-reproduced"]
    ]);
  });
});
