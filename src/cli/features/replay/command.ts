import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDomReplayActor,
  ObservableActionReplayDriver,
  observationSource,
  replayTrace,
  StateSequenceDriver,
  statesFromTrace,
  type ModalityReplayHarness,
  type ObservationSource,
} from "modality-ts/cli/harness";
import {
  canonicalJson,
  parseTraceArtifact,
  type ModelState,
  type ReplayReport,
  type Trace,
  type Value,
} from "modality-ts/core";

export interface ReplayCommandOptions {
  tracePath: string;
  statesPath?: string;
  observedPath?: string;
  mode?: "abstract" | "action";
  harnessPath?: string;
  reportPath?: string;
  now?: Date;
}

export interface ReplayCommandResult {
  report: ReplayReport;
  exitCode: number;
  lines: string[];
}

export async function runReplayCommand(
  options: ReplayCommandOptions,
): Promise<ReplayCommandResult> {
  const trace = parseTraceArtifact(await readFile(options.tracePath, "utf8"));
  const mode = options.mode ?? (options.harnessPath ? "action" : "abstract");
  const verdict =
    mode === "action"
      ? await replayAction(trace, options)
      : await replayAbstract(trace, options);
  const report: ReplayReport = {
    schemaVersion: 1,
    kind: "replay-report",
    generatedAt: (options.now ?? new Date()).toISOString(),
    mode,
    ...(options.harnessPath ? { harnessPath: options.harnessPath } : {}),
    verdict,
  };
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  return {
    report,
    exitCode:
      verdict.status === "reproduced"
        ? 0
        : verdict.status === "not-reproduced"
          ? 2
          : 3,
    lines: renderReplayReport(report),
  };
}

async function replayAbstract(trace: Trace, options: ReplayCommandOptions) {
  const states = await replayStates(options, trace);
  return replayTrace(trace, new StateSequenceDriver(states), {
    compareState: options.observedPath ? compareObservedState : undefined,
  });
}

async function replayAction(trace: Trace, options: ReplayCommandOptions) {
  if (!options.harnessPath) {
    return {
      status: "inconclusive" as const,
      stepsRun: 0,
      reason: "Action replay requires --harness",
    };
  }
  try {
    const harnessModule = await loadReplayHarness(options.harnessPath);
    await ensureDocument();
    const replayHarness = await harnessModule.renderModalityReplay(trace);
    const sources = [
      harnessModule.observeModalityReplay
        ? harnessModule.observeModalityReplay(replayHarness)
        : domProjectionSource(),
      ...(replayHarness.sources ?? []),
    ];
    const replayOptions = {
      inputValues: replayHarness.inputValues,
      assertViolation: replayHarness.assertViolation,
      beforeStep: replayHarness.beforeStep,
      afterStep: replayHarness.afterStep,
    };
    const actor = createDomReplayActor({
      document: replayHarness.document,
      navigate: replayHarness.navigate,
      resolve: replayHarness.resolve,
      focusRevalidate: replayHarness.focusRevalidate,
      timer: replayHarness.timer,
      stabilize: replayHarness.stabilize,
    });
    const observedVars =
      replayHarness.observedVars ??
      [
        ...new Set(
          trace.steps.flatMap((step) => [
            ...Object.keys(step.pre),
            ...Object.keys(step.post),
          ]),
        ),
      ].sort();
    return replayTrace(
      trace,
      new ObservableActionReplayDriver(
        actor,
        observedVars,
        sources,
        replayOptions,
      ),
    );
  } catch (error) {
    return {
      status: "inconclusive" as const,
      stepsRun: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

interface ReplayHarnessModule {
  renderModalityReplay(
    trace: Trace,
  ): ModalityReplayHarness | Promise<ModalityReplayHarness>;
  observeModalityReplay?(harness: ModalityReplayHarness): ObservationSource;
}

async function loadReplayHarness(
  harnessPath: string,
): Promise<ReplayHarnessModule> {
  const module = (await import(
    `${pathToFileURL(harnessPath).href}?t=${Date.now()}`
  )) as Partial<ReplayHarnessModule>;
  if (typeof module.renderModalityReplay !== "function") {
    throw new Error("Replay harness must export renderModalityReplay(trace)");
  }
  return module as ReplayHarnessModule;
}

async function ensureDocument(): Promise<void> {
  if (globalThis.document) return;
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Event: dom.window.Event,
  });
}

function domProjectionSource(): ObservationSource {
  return observationSource("dom-projection", (varId) => {
    const element = globalThis.document?.querySelector(
      `[data-modality-var="${cssString(varId)}"]`,
    );
    if (!element) return "unobservable";
    return { value: parseObservedValue(element.textContent ?? "") };
  });
}

function parseObservedValue(text: string): Value {
  try {
    return JSON.parse(text) as Value;
  } catch {
    return text;
  }
}

function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

async function replayStates(
  options: ReplayCommandOptions,
  trace: Trace,
): Promise<ModelState[]> {
  if (options.observedPath)
    return JSON.parse(
      await readFile(options.observedPath, "utf8"),
    ) as ModelState[];
  if (options.statesPath)
    return JSON.parse(
      await readFile(options.statesPath, "utf8"),
    ) as ModelState[];
  return statesFromTrace(trace);
}

function compareObservedState(
  expected: ModelState,
  observed: ModelState,
): string | undefined {
  for (const key of Object.keys(observed).sort()) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(observed[key])) {
      return `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(observed[key])}`;
    }
  }
  return undefined;
}

export function renderReplayReport(report: ReplayReport): string[] {
  const lines = [
    `replay: ${report.verdict.status}`,
    `mode=${report.mode ?? "abstract"}`,
    `stepsRun=${report.verdict.stepsRun}`,
  ];
  if (report.harnessPath) lines.push(`harness=${report.harnessPath}`);
  if (report.verdict.divergenceStep !== undefined)
    lines.push(`divergenceStep=${report.verdict.divergenceStep}`);
  if (report.verdict.reason) lines.push(`reason=${report.verdict.reason}`);
  return lines;
}
