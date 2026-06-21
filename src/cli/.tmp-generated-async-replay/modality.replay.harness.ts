globalThis.__modalityRenderReplayApp = (_trace, replayAsync) => {
  let status = "idle";
  document.body.replaceChildren();
  const form = document.createElement("form");
  form.dataset.testid = "checkout";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Submit";
  const output = document.createElement("output");
  output.setAttribute("data-modality-var", "status");
  const paint = () => { output.textContent = JSON.stringify(status); };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    status = "submitting";
    replayAsync.registerResponse("api.submitOrder", "success", { status: "done" }, (payload) => { status = payload && typeof payload === "object" && !Array.isArray(payload) && payload.status === "done" ? "done" : "failed"; paint(); });
    paint();
  });
  form.append(submit, output);
  document.body.append(form);
  paint();
  return {};
};
import { createDeterministicReplayAsyncController, observationSource, type DeterministicReplayAsyncController, type ModalityReplayHarness, type ObservationSource } from "modality-ts/cli/harness";
import { createBuiltinModalityRegistry, navigationObservationId, observationSourcesFromProviders, setupObservationProviders } from "modality-ts/cli/registry";
import type { Trace } from "modality-ts/core";

declare global {
  var __modalityRenderReplayApp: ((trace: Trace, replayAsync: DeterministicReplayAsyncController) => Partial<ModalityReplayHarness> | Promise<Partial<ModalityReplayHarness>>) | undefined;
}

export async function renderModalityReplay(trace: Trace): Promise<ModalityReplayHarness> {
  const replayAsync = createDeterministicReplayAsyncController();
  const registry = createBuiltinModalityRegistry();
  const observations = registry.adapters.observations;
  const observationRuntime = setupObservationProviders(
    observations,
    trace.steps[0]?.pre ? { initialState: trace.steps[0].pre } : {},
  );
  const providerSources = observationSourcesFromProviders(observations, observationRuntime);
  const navigation = registry.adapters.navigation;
  const navigationHandles = navigation
    ? observationRuntime.handlesByProviderId.get(navigationObservationId(navigation))
    : undefined;
  const appHarness = await globalThis.__modalityRenderReplayApp?.(trace, replayAsync);
  return {
    document: globalThis.document,
    resolve: replayAsync.resolve,
    replayAsync,
    stabilize: async () => Promise.resolve(),
    sources: providerSources,
    navigate: navigation && navigationHandles
      ? (mode, to) => { navigation.harness.navigate(navigationHandles, mode, to); }
      : undefined,
    ...(appHarness ?? {})
  };
}

export function observeModalityReplay(_harness: ModalityReplayHarness): ObservationSource {
  return observationSource("dom-projection", (varId) => {
    const element = globalThis.document?.querySelector(`[data-modality-var="${cssString(varId)}"]`);
    if (!element) return "unobservable";
    return { value: parseObservedValue(element.textContent ?? "") };
  });
}

function parseObservedValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
