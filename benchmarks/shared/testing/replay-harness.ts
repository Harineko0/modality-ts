import {
  createDeterministicReplayAsyncController,
  type ModalityReplayHarness,
} from "modality-ts/cli/harness";
import type { Trace, Value } from "modality-ts/core";
import {
  createBenchmarkObservationSource,
  type BenchmarkObservationHandles,
} from "./observation-map.js";

export interface ParkedEffectRequest {
  op: string;
  outcome: string;
  payload: Value;
}

export interface BenchmarkReplayContext {
  container: HTMLElement;
  document: Document;
  initialRoute: string;
  swrCache: Map<unknown, unknown>;
  pendingEffects: readonly ParkedEffectRequest[];
  parkEffect(request: ParkedEffectRequest): void;
  releaseEffect(op: string, outcome: string): Promise<void>;
}

export interface BenchmarkReplayMountResult {
  route?: () => Value;
  navigate?: ModalityReplayHarness["navigate"];
  cleanup?: () => Promise<void> | void;
  observation?: Partial<BenchmarkObservationHandles>;
}

export interface BenchmarkReplayHarnessOptions {
  initialRoute?: string;
  mount(
    context: BenchmarkReplayContext,
  ): BenchmarkReplayMountResult | Promise<BenchmarkReplayMountResult>;
  observe?: (
    context: BenchmarkReplayContext,
  ) => Partial<BenchmarkObservationHandles>;
  stabilize?: (context: BenchmarkReplayContext) => Promise<void> | void;
}

export function createBenchmarkReplayHarness(
  options: BenchmarkReplayHarnessOptions,
): {
  renderModalityReplay(trace: Trace): Promise<ModalityReplayHarness>;
  observeModalityReplay(
    harness: ModalityReplayHarness,
  ): ReturnType<typeof createBenchmarkObservationSource>;
} {
  let currentObservation: BenchmarkObservationHandles | undefined;
  return {
    async renderModalityReplay() {
      ensureDom();
      const doc = globalThis.document;
      doc.body.innerHTML = "";
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const replayAsync = createDeterministicReplayAsyncController();
      const pendingEffects: ParkedEffectRequest[] = [];
      const context: BenchmarkReplayContext = {
        container,
        document: doc,
        initialRoute: options.initialRoute ?? "/login",
        swrCache: new Map(),
        get pendingEffects() {
          return pendingEffects;
        },
        parkEffect(request) {
          pendingEffects.push(request);
          replayAsync.registerResponse(
            request.op,
            request.outcome,
            request.payload,
            () => {
              const index = pendingEffects.findIndex(
                (pending) =>
                  pending.op === request.op &&
                  pending.outcome === request.outcome,
              );
              if (index >= 0) pendingEffects.splice(index, 1);
            },
          );
        },
        async releaseEffect(op, outcome) {
          await replayAsync.resolveResponse(op, outcome);
        },
      };
      const mounted = await options.mount(context);
      currentObservation = {
        route: mounted.route,
        pending: () =>
          pendingEffects.map((request) => ({
            opId: request.op,
            outcome: request.outcome,
          })),
        swr: (varId) => readSWRCache(context.swrCache, varId),
        dom: (varId) => readDomProjection(doc, varId),
        ...options.observe?.(context),
        ...mounted.observation,
      };
      await stabilize(context, options.stabilize);
      return {
        document: doc,
        navigate: mounted.navigate,
        resolve: async (op, outcome) => {
          await context.releaseEffect(op, outcome);
        },
        focusRevalidate: async () => {
          await stabilize(context, options.stabilize);
        },
        timer: async () => {
          await stabilize(context, options.stabilize);
        },
        stabilize: async () => {
          await stabilize(context, options.stabilize);
        },
        replayAsync,
        sources: [createBenchmarkObservationSource(currentObservation)],
        afterStep: async () => {
          await stabilize(context, options.stabilize);
        },
        beforeStep: async () => {
          await stabilize(context, options.stabilize);
        },
        assertViolation: async () => {
          await mounted.cleanup?.();
          return true;
        },
      };
    },
    observeModalityReplay() {
      if (!currentObservation) {
        throw new Error("renderModalityReplay must run before observation");
      }
      return createBenchmarkObservationSource(currentObservation);
    },
  };
}

async function stabilize(
  context: BenchmarkReplayContext,
  extra: BenchmarkReplayHarnessOptions["stabilize"],
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await extra?.(context);
}

function readSWRCache(
  cache: Map<unknown, unknown>,
  varId: string,
): Value | "unobservable" {
  for (const [key, value] of cache.entries()) {
    if (varId.includes(String(Array.isArray(key) ? key[0] : key))) {
      return toValue(value);
    }
  }
  return "unobservable";
}

function readDomProjection(
  doc: Document,
  varId: string,
): Value | "unobservable" {
  const element = doc.querySelector(
    `[data-modality-var="${varId.replace(/["\\]/g, "\\$&")}"]`,
  );
  if (!element) return "unobservable";
  const text = element.textContent ?? "";
  try {
    return JSON.parse(text) as Value;
  } catch {
    return text;
  }
}

function toValue(value: unknown): Value {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toValue(item)]),
    );
  }
  return String(value);
}

function ensureDom(): void {
  if (globalThis.document) return;
  throw new Error("action conformance requires a jsdom document");
}
