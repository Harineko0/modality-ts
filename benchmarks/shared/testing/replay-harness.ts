import {
  createDeterministicReplayAsyncController,
  type ModalityReplayHarness,
} from "modality-ts/cli/harness";
import type { Trace, Value } from "modality-ts/core";
import {
  type BenchmarkObservationHandles,
  createBenchmarkObservationSource,
} from "./observation-map.js";

export interface ParkedEffectRequest {
  op: string;
  outcome: string;
  payload: Value;
}

export interface BenchmarkReadableStore {
  getState(): Record<string, unknown>;
}

export interface BenchmarkReplayContext {
  container: HTMLElement;
  document: Document;
  initialRoute: string;
  swrCache: Map<unknown, unknown>;
  swrKeys: Map<string, readonly unknown[]>;
  localStateDefaults: Map<string, Value>;
  zustandStores: Map<string, BenchmarkReadableStore>;
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
        swrKeys: new Map(),
        localStateDefaults: new Map(),
        zustandStores: new Map(),
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
        swr: (hook, field) =>
          readSWRCache(context.swrCache, context.swrKeys, hook, field),
        zustand: (store, field) =>
          readZustandStore(context.zustandStores, store, field),
        useState: (component, field) =>
          readUseStateProjection(
            doc,
            context.localStateDefaults,
            component,
            field,
          ),
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
  keyBindings: Map<string, readonly unknown[]>,
  hook: string,
  field: string,
): Value | "unobservable" {
  for (const key of keyBindings.get(hook) ?? []) {
    const cached = readCacheKey(cache, key);
    if (cached !== undefined) return swrFieldValue(cached, field);
  }
  return defaultSWRFieldValue(field);
}

function readCacheKey(cache: Map<unknown, unknown>, key: unknown): unknown {
  for (const candidate of cacheKeyCandidates(key)) {
    if (cache.has(candidate)) return cache.get(candidate);
  }
  return undefined;
}

function cacheKeyCandidates(key: unknown): unknown[] {
  if (Array.isArray(key)) {
    return [key, stableSWRKey(key), JSON.stringify(key)];
  }
  return [key];
}

function stableSWRKey(key: unknown): string {
  if (Array.isArray(key)) {
    return `@${key.map(stableSWRKey).join(",")},`;
  }
  if (typeof key === "string") return JSON.stringify(key);
  if (typeof key === "number" || typeof key === "boolean" || key === null) {
    return JSON.stringify(key);
  }
  if (typeof key === "object" && key !== null) {
    return `#${Object.entries(key as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entryKey, value]) => `${entryKey}:${stableSWRKey(value)}`)
      .join(",")},`;
  }
  return String(key);
}

function swrFieldValue(cached: unknown, field: string): Value {
  if (field === "error") {
    return Boolean(readObjectField(cached, "error"));
  }
  if (field === "isValidating") {
    return Boolean(readObjectField(cached, "isValidating"));
  }
  if (field === "data") {
    const data = readObjectField(cached, "data");
    return toValue(data === undefined ? cached : data);
  }
  return toValue(readObjectField(cached, field) ?? null);
}

function defaultSWRFieldValue(field: string): Value | "unobservable" {
  if (field === "data") return null;
  if (field === "error" || field === "isValidating") return false;
  return "unobservable";
}

function readZustandStore(
  stores: Map<string, BenchmarkReadableStore>,
  store: string,
  field: string,
): Value | "unobservable" {
  const state = stores.get(store)?.getState();
  if (!state || !(field in state)) return "unobservable";
  return toBenchmarkStoreValue(state[field]);
}

function readUseStateProjection(
  doc: Document,
  defaults: Map<string, Value>,
  component: string,
  field: string,
): Value | "unobservable" {
  const varId = `local:${component}.${field}`;
  const projected = readDomProjection(doc, varId);
  if (projected !== "unobservable") return projected;
  return defaults.has(varId) ? (defaults.get(varId) ?? null) : "unobservable";
}

function toBenchmarkStoreValue(value: unknown): Value {
  if (typeof value === "number") return "tok1";
  if (Array.isArray(value)) return value.map(toBenchmarkStoreValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, toBenchmarkStoreValue(item)]),
    );
  }
  return toValue(value);
}

function readObjectField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[field];
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
