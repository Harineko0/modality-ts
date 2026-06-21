import { describe, expect, it, vi } from "vitest";
import { BasicReporter } from "./basic.js";
import { DefaultReporter } from "./default.js";
import { JsonReporter } from "./json.js";
import { createReporter } from "./index.js";
import { runReport } from "./run-session.js";
import type { ReporterTask } from "./types.js";

describe("createReporter", () => {
  it("returns BasicReporter for 'basic'", () => {
    expect(createReporter("basic")).toBeInstanceOf(BasicReporter);
  });

  it("returns JsonReporter for 'json'", () => {
    expect(createReporter("json")).toBeInstanceOf(JsonReporter);
  });

  it("returns DefaultReporter for 'default' and unknown names", () => {
    expect(createReporter("default")).toBeInstanceOf(DefaultReporter);
    expect(createReporter("unknown")).toBeInstanceOf(DefaultReporter);
  });
});

describe("BasicReporter", () => {
  it("run executes tasks sequentially and returns entries", async () => {
    const reporter = new BasicReporter();
    const order: number[] = [];
    const tasks: ReporterTask<number>[] = [
      {
        title: "task1",
        run: async () => {
          order.push(1);
          return { entry: 1, lines: ["line1"], status: "pass" };
        },
      },
      {
        title: "task2",
        run: async () => {
          order.push(2);
          return { entry: 2, lines: ["line2"], status: "fail" };
        },
      },
    ];
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) =>
      logged.push(line),
    );
    const entries = await reporter.run({
      meta: { command: "check", startedAt: new Date() },
      tasks,
      renderFooter: () => ["footer-line"],
    });
    vi.restoreAllMocks();
    expect(order).toEqual([1, 2]);
    expect(entries).toEqual([1, 2]);
    expect(logged).toContain("line1");
    expect(logged).toContain("line2");
    expect(logged).toContain("footer-line");
  });
});

describe("JsonReporter", () => {
  it("run emits parseable JSON to stdout with command, startedAt, and targets", async () => {
    const reporter = new JsonReporter();
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      written.push(String(data));
      return true;
    });

    const tasks: ReporterTask<{ name: string }>[] = [
      {
        title: "t1",
        run: async () => ({
          entry: { name: "a" },
          lines: [],
          status: "pass",
        }),
      },
      {
        title: "t2",
        run: async () => ({
          entry: { name: "b" },
          lines: [],
          status: "fail",
        }),
      },
    ];

    const startedAt = new Date("2026-06-21T00:00:00.000Z");
    const entries = await reporter.run({
      meta: { command: "check", startedAt },
      tasks,
      renderFooter: () => [],
    });
    vi.restoreAllMocks();

    expect(entries).toEqual([{ name: "a" }, { name: "b" }]);
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0]!);
    expect(parsed.command).toBe("check");
    expect(parsed.startedAt).toBe("2026-06-21T00:00:00.000Z");
    expect(parsed.targets).toHaveLength(2);
    expect(parsed.targets[0].status).toBe("pass");
    expect(parsed.targets[1].status).toBe("fail");
    expect(parsed.targets[0].entry).toEqual({ name: "a" });
  });
});

describe("runReport orchestrator", () => {
  it("delegates to reporter.run and returns entries", async () => {
    const reporter = new BasicReporter();
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => logged.push(l));

    const task1: ReporterTask<string> = {
      title: "t1",
      run: async () => ({ entry: "entry1", lines: ["detail1"], status: "pass" }),
    };
    const task2: ReporterTask<string> = {
      title: "t2",
      run: async () => ({ entry: "entry2", lines: ["detail2"], status: "warn" }),
    };

    const entries = await runReport({
      reporter,
      meta: { command: "extract", startedAt: new Date() },
      tasks: [task1, task2],
      renderFooter: (ctx) => [`summary: ${ctx.entries.join(",")}`],
      startedMs: performance.now(),
    });

    vi.restoreAllMocks();

    expect(entries).toEqual(["entry1", "entry2"]);
    expect(logged).toContain("detail1");
    expect(logged).toContain("detail2");
    expect(logged.some((l) => l.startsWith("summary:"))).toBe(true);
    expect(logged.find((l) => l.startsWith("summary:"))!).toContain("entry1");
  });
});
