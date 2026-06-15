globalThis.__modalityRenderReplayApp = () => {
  let flag = false;
  document.body.replaceChildren();
  const button = document.createElement("button");
  button.dataset.testid = "set-flag";
  button.textContent = "Set flag";
  const output = document.createElement("output");
  output.setAttribute("data-modality-var", "flag");
  const paint = () => {
    output.textContent = JSON.stringify(flag);
  };
  button.addEventListener("click", () => {
    flag = true;
    paint();
  });
  document.body.append(button, output);
  paint();
  return {};
};
import {
  createDeterministicReplayAsyncController,
  observationSource,
  type DeterministicReplayAsyncController,
  type ModalityReplayHarness,
  type ObservationSource,
} from "modality-ts/cli/harness";
import type { Trace } from "modality-ts/core";

declare global {
  var __modalityRenderReplayApp:
    | ((
        trace: Trace,
        replayAsync: DeterministicReplayAsyncController,
      ) =>
        | Partial<ModalityReplayHarness>
        | Promise<Partial<ModalityReplayHarness>>)
    | undefined;
}

export async function renderModalityReplay(
  trace: Trace,
): Promise<ModalityReplayHarness> {
  const replayAsync = createDeterministicReplayAsyncController();
  const appHarness = await globalThis.__modalityRenderReplayApp?.(
    trace,
    replayAsync,
  );
  return {
    document: globalThis.document,
    resolve: replayAsync.resolve,
    replayAsync,
    stabilize: async () => Promise.resolve(),
    ...(appHarness ?? {}),
  };
}

export function observeModalityReplay(
  _harness: ModalityReplayHarness,
): ObservationSource {
  return observationSource("dom-projection", (varId) => {
    const element = globalThis.document?.querySelector(
      `[data-modality-var="${cssString(varId)}"]`,
    );
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
