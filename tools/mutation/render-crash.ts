import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ModalityReplayHarness } from "modality-ts/cli/harness";
import { type Model, parseModelArtifact, type Trace } from "modality-ts/core";

interface RenderCrashHarnessModule {
  renderModalityReplay(
    trace: Trace,
  ): ModalityReplayHarness | Promise<ModalityReplayHarness>;
}

/**
 * Mount every route the model can reach and report which ones throw during
 * render.
 *
 * A mutant that breaks a component's render is a real defect, but the abstract
 * model cannot see it (an error boundary preserves the surrounding observable
 * state) and a random walk only reaches the broken route by luck. Mounting each
 * route directly makes the check deterministic: every route's initial render is
 * exercised regardless of which transitions a walk happens to take.
 *
 * Returns a map from route to the crash description reported by the harness.
 * Routes that render cleanly are omitted.
 */
export async function detectRouteRenderCrashes(input: {
  modelPath: string;
  harnessPath: string;
}): Promise<Map<string, string>> {
  const model = parseModelArtifact(await readFile(input.modelPath, "utf8"));
  const routes = routeValuesFromModel(model);
  if (routes.length === 0) return new Map();
  await ensureDocument();
  const harnessModule = (await import(
    `${pathToFileURL(input.harnessPath).href}?t=${Date.now()}`
  )) as Partial<RenderCrashHarnessModule>;
  if (typeof harnessModule.renderModalityReplay !== "function")
    return new Map();
  const crashes = new Map<string, string>();
  for (const route of routes) {
    const trace: Trace = {
      steps: [
        {
          transitionId: "render-smoke",
          pre: { "sys:route": route },
          post: { "sys:route": route },
        },
      ],
    };
    try {
      const harness = await harnessModule.renderModalityReplay(trace);
      await harness.stabilize?.();
      const crash = harness.crash?.();
      if (crash) crashes.set(route, crash);
    } catch (error) {
      crashes.set(
        route,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return crashes;
}

/**
 * Routes whose render crashed in the mutant but not the baseline, with the
 * mutant's crash description. A crash already present in the baseline is
 * pre-existing and ignored.
 */
export function newRouteRenderCrashes(
  baseline: ReadonlyMap<string, string>,
  mutant: ReadonlyMap<string, string>,
): { route: string; reason: string }[] {
  return [...mutant]
    .filter(([route]) => !baseline.has(route))
    .map(([route, reason]) => ({ route, reason }))
    .sort((left, right) => left.route.localeCompare(right.route));
}

function routeValuesFromModel(model: Model): string[] {
  const route = model.vars.find((decl) => decl.id === "sys:route");
  if (route?.domain.kind === "enum") {
    return route.domain.values.filter(
      (value): value is string => typeof value === "string",
    );
  }
  return [];
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
