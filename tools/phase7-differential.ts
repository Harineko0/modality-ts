import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkModel, modelInitialStates } from "../src/check/index.ts";
import type {
  ExprIR,
  Model,
  StateVarDecl,
  Transition,
  Value,
} from "../src/core/index.ts";
import { generateTlaModule } from "../src/cli/features/export/command.ts";
import { checkoutHandModel } from "../test/modality/fixtures/checkout-hand-model.ts";
import { todoHandModel } from "../test/modality/fixtures/todo-hand-model.ts";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tlcDownloadUrl =
  "https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar";

interface TlcStats {
  statesGenerated: number;
  distinctStates: number;
  depth: number;
}

async function main(): Promise<void> {
  const randomCount = numberArg("--random", 1000);
  const tlcJar = await resolveTlcJar();
  const workDir = await mkdtemp(join(tmpdir(), "modality-phase7-"));
  try {
    const handModels = [
      { name: "TodoHand", model: withDepth(todoHandModel(), 64) },
      { name: "CheckoutHand", model: withDepth(checkoutHandModel(), 64) },
    ];
    for (const { name, model } of handModels) {
      const checker = checkModel(model, []);
      const tlc = await runTlc(
        tlcJar,
        workDir,
        name,
        generateTlaModule(model, name),
      );
      assertEqual(
        `${name} reachable states`,
        tlc.distinctStates,
        checker.stats.states,
      );
      assertEqual(
        `${name} generated states`,
        tlc.statesGenerated,
        checker.stats.edges + modelInitialStates(model).length,
      );
      console.log(
        `${name}: checker states=${checker.stats.states} edges=${checker.stats.edges}; TLC distinct=${tlc.distinctStates} generated=${tlc.statesGenerated}`,
      );
    }

    const numericModels = [
      { name: "NumericCounter", model: withDepth(boundedCounterModel(), 8) },
      { name: "NumericSparseSet", model: withDepth(sparseIntSetModel(), 8) },
      { name: "NumericWrap", model: withDepth(wrapOverflowModel(), 8) },
      { name: "NumericSaturate", model: withDepth(saturateOverflowModel(), 8) },
      {
        name: "NumericSatCounter",
        model: withDepth(saturationCounterReducedModel(), 8),
      },
    ];
    for (const { name, model } of numericModels) {
      const checker = checkModel(model, []);
      const tlc = await runTlc(
        tlcJar,
        workDir,
        name,
        generateTlaModule(model, name),
      );
      assertEqual(
        `${name} reachable states`,
        tlc.distinctStates,
        checker.stats.states,
      );
      assertEqual(
        `${name} generated states`,
        tlc.statesGenerated,
        checker.stats.edges + modelInitialStates(model).length,
      );
      console.log(
        `${name}: checker states=${checker.stats.states} edges=${checker.stats.edges}; TLC distinct=${tlc.distinctStates} generated=${tlc.statesGenerated}`,
      );
    }

    const neutralModels = [
      {
        name: "NeutralAssignment",
        model: withDepth(neutralAssignmentModel(), 4),
      },
      { name: "NeutralLocation", model: withDepth(neutralLocationModel(), 4) },
      { name: "NeutralPending", model: withDepth(neutralPendingModel(), 4) },
      {
        name: "NeutralMountReset",
        model: withDepth(neutralMountResetModel(), 4),
      },
    ];
    for (const { name, model } of neutralModels) {
      const checker = checkModel(model, []);
      const tlc = await runTlc(
        tlcJar,
        workDir,
        name,
        generateTlaModule(model, name),
      );
      assertEqual(
        `${name} reachable states`,
        tlc.distinctStates,
        checker.stats.states,
      );
      assertEqual(
        `${name} generated states`,
        tlc.statesGenerated,
        checker.stats.edges + modelInitialStates(model).length,
      );
      console.log(
        `${name}: checker states=${checker.stats.states} edges=${checker.stats.edges}; TLC distinct=${tlc.distinctStates} generated=${tlc.statesGenerated}`,
      );
    }

    const randomModels = Array.from({ length: randomCount }, (_value, index) =>
      randomModel(index),
    );
    const expected = corpusExpected(randomModels);
    const chunkSize = numberArg("--chunk", 100);
    const corpusTlc = { statesGenerated: 0, distinctStates: 0, depth: 0 };
    for (const [chunkIndex, chunk] of chunks(
      randomModels,
      chunkSize,
    ).entries()) {
      const moduleName = `RandomCorpus${chunkIndex + 1}`;
      const stats = await runTlc(
        tlcJar,
        workDir,
        moduleName,
        generateTlaModule(combineCorpus(chunk), moduleName),
      );
      corpusTlc.statesGenerated += stats.statesGenerated;
      corpusTlc.distinctStates += stats.distinctStates;
      corpusTlc.depth = Math.max(corpusTlc.depth, stats.depth);
    }
    assertEqual(
      "RandomCorpus reachable states",
      corpusTlc.distinctStates,
      expected.states,
    );
    assertEqual(
      "RandomCorpus generated states",
      corpusTlc.statesGenerated,
      expected.generated,
    );
    console.log(
      `RandomCorpus: models=${randomCount} chunks=${Math.ceil(randomCount / chunkSize)} checker states=${expected.states} generated=${expected.generated}; TLC distinct=${corpusTlc.distinctStates} generated=${corpusTlc.statesGenerated}`,
    );

    const porModel = porParityModel();
    const porProperties = [
      {
        kind: "always" as const,
        name: "ok",
        predicate: { kind: "lit" as const, value: true },
        reads: [] as string[],
      },
    ];
    const withoutPor = checkModel(porModel, porProperties);
    const withPor = checkModel(porModel, porProperties, {
      partialOrderReduction: true,
    });
    assertPorParity("PorParity", withoutPor, withPor);
    console.log(
      `PorParity: withoutPor edges=${withoutPor.stats.edges} withPor edges=${withPor.stats.edges} skippedTransitions=${withPor.diagnostics?.partialOrderReduction?.skippedTransitions ?? 0}`,
    );

    console.log("phase7-differential: passed");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function corpusExpected(models: readonly Model[]): {
  states: number;
  generated: number;
} {
  return models.reduce(
    (sum, model) => {
      const result = checkModel(model, []);
      return {
        states: sum.states + result.stats.states,
        generated:
          sum.generated + modelInitialStates(model).length + result.stats.edges,
      };
    },
    { states: 0, generated: 0 },
  );
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1)
    throw new Error("--chunk must be a positive integer");
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function withDepth(model: Model, maxDepth: number): Model {
  return { ...model, bounds: { ...model.bounds, maxDepth } };
}

function boundedCounterModel(): Model {
  const route = routeDecl();
  return {
    schemaVersion: 1,
    id: "numeric-counter",
    bounds: { maxDepth: 8, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      route,
      historyDecl(route.domain),
      pendingDecl(0),
      {
        id: "count",
        domain: { kind: "boundedInt", min: 0, max: 3, overflow: "forbid" },
        origin: "system",
        scope: { kind: "global" },
        initial: 0,
      },
    ],
    transitions: [
      {
        id: "inc",
        cls: "user",
        label: { kind: "click", text: "inc" },
        source: [],
        guard: {
          kind: "lt",
          args: [read("count"), lit(3)],
        },
        effect: {
          kind: "assign",
          var: "count",
          expr: {
            kind: "add",
            args: [read("count"), lit(1)],
          },
        },
        reads: ["count"],
        writes: ["count"],
        confidence: "exact",
      },
    ],
  };
}

function sparseIntSetModel(): Model {
  const route = routeDecl();
  return {
    schemaVersion: 1,
    id: "numeric-sparse",
    bounds: { maxDepth: 8, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      route,
      historyDecl(route.domain),
      pendingDecl(0),
      {
        id: "phase",
        domain: { kind: "intSet", values: [0, 2], overflow: "forbid" },
        origin: "system",
        scope: { kind: "global" },
        initial: 0,
      },
    ],
    transitions: [
      {
        id: "advance",
        cls: "user",
        label: { kind: "click", text: "advance" },
        source: [],
        guard: { kind: "lit", value: true },
        effect: {
          kind: "assign",
          var: "phase",
          expr: {
            kind: "add",
            args: [read("phase"), lit(2)],
          },
        },
        reads: ["phase"],
        writes: ["phase"],
        confidence: "exact",
      },
    ],
  };
}

function wrapOverflowModel(): Model {
  const route = routeDecl();
  return {
    schemaVersion: 1,
    id: "numeric-wrap",
    bounds: { maxDepth: 8, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      route,
      historyDecl(route.domain),
      pendingDecl(0),
      {
        id: "count",
        domain: { kind: "boundedInt", min: 0, max: 3, overflow: "wrap" },
        origin: "system",
        scope: { kind: "global" },
        initial: 3,
      },
    ],
    transitions: [
      {
        id: "inc",
        cls: "user",
        label: { kind: "click", text: "inc" },
        source: [],
        guard: { kind: "lit", value: true },
        effect: {
          kind: "assign",
          var: "count",
          expr: {
            kind: "add",
            args: [read("count"), lit(1)],
          },
        },
        reads: ["count"],
        writes: ["count"],
        confidence: "exact",
      },
    ],
  };
}

function saturationCounterReducedModel(): Model {
  const route = routeDecl();
  return {
    schemaVersion: 1,
    id: "numeric-sat-counter",
    bounds: { maxDepth: 8, maxPending: 0, maxInternalSteps: 4 },
    metadata: {
      numericReductions: {
        entries: [
          {
            varId: "count",
            kind: "saturation",
            claim: "property-preserving",
            reason: "Saturation counter: 3+ collapsed to sentinel 4",
          },
        ],
      },
    },
    vars: [
      route,
      historyDecl(route.domain),
      pendingDecl(0),
      {
        id: "count",
        domain: {
          kind: "intSet",
          values: [0, 1, 2, 3, 4],
          overflow: "saturate",
        },
        origin: "system",
        scope: { kind: "global" },
        initial: 0,
      },
    ],
    transitions: [
      {
        id: "inc",
        cls: "user",
        label: { kind: "click", text: "inc" },
        source: [],
        guard: { kind: "lit", value: true },
        effect: {
          kind: "assign",
          var: "count",
          expr: {
            kind: "add",
            args: [read("count"), lit(1)],
          },
        },
        reads: ["count"],
        writes: ["count"],
        confidence: "exact",
      },
    ],
  };
}

function saturateOverflowModel(): Model {
  const route = routeDecl();
  return {
    schemaVersion: 1,
    id: "numeric-saturate",
    bounds: { maxDepth: 8, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      route,
      historyDecl(route.domain),
      pendingDecl(0),
      {
        id: "count",
        domain: { kind: "boundedInt", min: 0, max: 3, overflow: "saturate" },
        origin: "system",
        scope: { kind: "global" },
        initial: 3,
      },
    ],
    transitions: [
      {
        id: "inc",
        cls: "user",
        label: { kind: "click", text: "inc" },
        source: [],
        guard: { kind: "lit", value: true },
        effect: {
          kind: "assign",
          var: "count",
          expr: {
            kind: "add",
            args: [read("count"), lit(1)],
          },
        },
        reads: ["count"],
        writes: ["count"],
        confidence: "exact",
      },
    ],
  };
}

async function resolveTlcJar(): Promise<string> {
  const configured = process.env.TLA2TOOLS_JAR ?? process.env.TLC_JAR;
  if (configured) return configured;
  const cacheDir = join(repoRoot, "node_modules", ".cache", "modality");
  const jarPath = join(cacheDir, "tla2tools.jar");
  try {
    await readFile(jarPath);
    return jarPath;
  } catch {
    await mkdir(cacheDir, { recursive: true });
    console.log(`Downloading TLC: ${tlcDownloadUrl}`);
    await execFileAsync(
      "curl",
      [
        "-L",
        "--fail",
        "--silent",
        "--show-error",
        "-o",
        jarPath,
        tlcDownloadUrl,
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    return jarPath;
  }
}

async function runTlc(
  tlcJar: string,
  workDir: string,
  moduleName: string,
  source: string,
): Promise<TlcStats> {
  const moduleDir = join(workDir, moduleName);
  await mkdir(moduleDir, { recursive: true });
  await writeFile(join(moduleDir, `${moduleName}.tla`), source, "utf8");
  await writeFile(
    join(moduleDir, `${moduleName}.cfg`),
    "SPECIFICATION Spec\nCHECK_DEADLOCK FALSE\n",
    "utf8",
  );
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(
      "java",
      [
        "-jar",
        tlcJar,
        "-nowarning",
        "-config",
        `${moduleName}.cfg`,
        `${moduleName}.tla`,
      ],
      {
        cwd: moduleDir,
        maxBuffer: 1024 * 1024 * 16,
      },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `TLC failed for ${moduleName}: ${failed.message}\n${failed.stdout ?? ""}\n${failed.stderr ?? ""}`,
    );
  }
  const output = `${stdout}\n${stderr}`;
  const counts = /(\d+) states generated, (\d+) distinct states found/.exec(
    output,
  );
  const depth = /The depth of the complete state graph search is (\d+)\./.exec(
    output,
  );
  if (!counts || !depth)
    throw new Error(`Could not parse TLC output for ${moduleName}:\n${output}`);
  return {
    statesGenerated: Number(counts[1]),
    distinctStates: Number(counts[2]),
    depth: Number(depth[1]),
  };
}

function randomModel(index: number): Model {
  const name = `m${index}`;
  const flag = `${name}:flag`;
  const mode = `${name}:mode`;
  const route = routeDecl();
  const transitions: Transition[] = [
    transition(
      `${name}:setFlag`,
      name,
      lit(true),
      assign(flag, true),
      [],
      [flag],
    ),
    transition(
      `${name}:clearFlag`,
      name,
      read(flag),
      assign(flag, false),
      [flag],
      [flag],
    ),
    transition(
      `${name}:chooseFlag`,
      name,
      lit(true),
      { kind: "choose", var: flag, among: [lit(false), lit(true)] },
      [],
      [flag],
    ),
    transition(
      `${name}:setMode`,
      name,
      read(flag),
      assign(mode, index % 2 === 0 ? "a" : "b"),
      [flag],
      [mode],
    ),
    transition(
      `${name}:branch`,
      name,
      lit(true),
      {
        kind: "if",
        cond: read(flag),
        // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
        then: assign(mode, "c"),
        else: assign(mode, "a"),
      },
      [flag],
      [mode],
    ),
  ];
  if (index % 5 === 0) {
    transitions.push(
      transition(
        `${name}:havocMode`,
        name,
        lit(true),
        { kind: "havoc", var: mode },
        [],
        [mode],
      ),
    );
  }
  if (index % 7 === 0) {
    transitions.push(
      transition(
        `${name}:seq`,
        name,
        lit(true),
        { kind: "seq", effects: [assign(flag, true), assign(mode, "b")] },
        [],
        [flag, mode],
      ),
    );
  }
  return {
    schemaVersion: 1,
    id: `${name}-random`,
    bounds: { maxDepth: 8, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      route,
      historyDecl(route.domain),
      pendingDecl(0),
      modelIdDecl([name], name),
      {
        id: flag,
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: index % 3 === 0,
      },
      {
        id: mode,
        domain: { kind: "enum", values: ["a", "b", "c"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "a",
      },
    ],
    transitions,
  };
}

function combineCorpus(models: readonly Model[]): Model {
  const ids = models.map((model) =>
    String(model.vars.find((decl) => decl.id === "corpus:model")?.initial),
  );
  const route = routeDecl();
  const vars: StateVarDecl[] = [
    route,
    historyDecl(route.domain),
    pendingDecl(0),
    modelIdDecl(ids, ids),
  ];
  const transitions: Transition[] = [];
  for (const model of models) {
    vars.push(
      ...model.vars.filter(
        (decl) => !decl.id.startsWith("sys:") && decl.id !== "corpus:model",
      ),
    );
    transitions.push(...model.transitions);
  }
  return {
    schemaVersion: 1,
    id: "random-corpus",
    bounds: { maxDepth: 8, maxPending: 0, maxInternalSteps: 4 },
    vars,
    transitions,
  };
}

function transition(
  id: string,
  modelId: string,
  guard: ExprIR,
  effect: Transition["effect"],
  reads: string[],
  writes: string[],
): Transition {
  return {
    id,
    cls: "user",
    label: { kind: "click", text: id },
    source: [],
    guard: and(eq(read("corpus:model"), lit(modelId)), guard),
    effect,
    reads: ["corpus:model", ...reads],
    writes,
    confidence: "exact",
  };
}

function neutralAssignmentModel(): Model {
  return {
    schemaVersion: 1,
    id: "neutral-assignment",
    bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      {
        id: "flag",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "set",
        cls: "user",
        label: { kind: "click", text: "Set" },
        source: [],
        guard: { kind: "not", args: [read("flag")] },
        effect: { kind: "assign", var: "flag", expr: lit(true) },
        reads: ["flag"],
        writes: ["flag"],
        confidence: "exact",
      },
    ],
  };
}

function neutralLocationModel(): Model {
  const routes = { kind: "enum", values: ["/a", "/b"] } as const;
  return {
    schemaVersion: 1,
    id: "neutral-location",
    bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      {
        id: "app:location",
        domain: routes,
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-current" },
        initial: "/a",
      },
      {
        id: "app:history",
        domain: { kind: "boundedList", inner: routes, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-history", group: "default" },
        initial: [],
      },
    ],
    transitions: [
      {
        id: "goB",
        cls: "user",
        label: { kind: "click", text: "Go B" },
        source: [],
        guard: { kind: "eq", args: [read("app:location"), lit("/a")] },
        effect: { kind: "assign", var: "app:location", expr: lit("/b") },
        reads: ["app:location"],
        writes: ["app:location"],
        confidence: "exact",
      },
      {
        id: "goA",
        cls: "user",
        label: { kind: "click", text: "Go A" },
        source: [],
        guard: { kind: "eq", args: [read("app:location"), lit("/b")] },
        effect: { kind: "assign", var: "app:location", expr: lit("/a") },
        reads: ["app:location"],
        writes: ["app:location"],
        confidence: "exact",
      },
    ],
  };
}

function neutralPendingModel(): Model {
  const pendingOp = {
    kind: "record",
    fields: {
      opId: { kind: "enum", values: ["POST"] },
      continuation: { kind: "enum", values: ["noop"] },
      args: { kind: "record", fields: {} },
    },
  } as const;
  return {
    schemaVersion: 1,
    id: "neutral-pending",
    bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "app:asyncQueue",
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      {
        id: "flag",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "submit",
        cls: "user",
        label: { kind: "submit", text: "Submit" },
        source: [],
        guard: { kind: "not", args: [read("flag")] },
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "flag", expr: lit(true) },
            {
              kind: "enqueue",
              queue: "app:asyncQueue",
              op: "POST",
              continuation: "noop",
              args: {},
            },
          ],
        },
        reads: ["flag"],
        writes: ["flag", "app:asyncQueue"],
        confidence: "exact",
      },
      {
        id: "resolve",
        cls: "env",
        label: { kind: "resolve", op: "POST", outcome: "success" },
        source: [],
        guard: {
          kind: "eq",
          args: [
            { kind: "read", var: "app:asyncQueue", path: ["0", "opId"] },
            lit("POST"),
          ],
        },
        effect: { kind: "dequeue", queue: "app:asyncQueue", index: 0 },
        reads: ["app:asyncQueue"],
        writes: ["app:asyncQueue"],
        confidence: "exact",
      },
    ],
  };
}

function neutralMountResetModel(): Model {
  const routes = { kind: "enum", values: ["/a", "/b"] } as const;
  return {
    schemaVersion: 1,
    id: "neutral-mount-reset",
    bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      {
        id: "app:location",
        domain: routes,
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-current" },
        initial: "/a",
      },
      {
        id: "local:panel",
        domain: { kind: "enum", values: ["off", "on"] },
        origin: "system",
        scope: {
          kind: "mount-local",
          id: "route-a",
          when: {
            kind: "eq",
            args: [read("app:location"), lit("/a")],
          },
        },
        initial: "off",
      },
    ],
    transitions: [
      {
        id: "goB",
        cls: "user",
        label: { kind: "click", text: "Go B" },
        source: [],
        guard: { kind: "eq", args: [read("app:location"), lit("/a")] },
        effect: { kind: "assign", var: "app:location", expr: lit("/b") },
        reads: ["app:location"],
        writes: ["app:location"],
        confidence: "exact",
      },
      {
        id: "goA",
        cls: "user",
        label: { kind: "click", text: "Go A" },
        source: [],
        guard: { kind: "eq", args: [read("app:location"), lit("/b")] },
        effect: { kind: "assign", var: "app:location", expr: lit("/a") },
        reads: ["app:location"],
        writes: ["app:location"],
        confidence: "exact",
      },
    ],
  };
}

function routeDecl(): StateVarDecl {
  return {
    id: "sys:route",
    domain: { kind: "enum", values: ["/"] },
    origin: "system",
    scope: { kind: "global" },
    initial: "/",
  };
}

function historyDecl(routeDomain: StateVarDecl["domain"]): StateVarDecl {
  return {
    id: "sys:history",
    domain: { kind: "boundedList", inner: routeDomain, maxLen: 1 },
    origin: "system",
    scope: { kind: "global" },
    initial: [],
  };
}

function pendingDecl(maxLen: number): StateVarDecl {
  return {
    id: "sys:pending",
    domain: {
      kind: "boundedList",
      inner: {
        kind: "record",
        fields: {
          opId: { kind: "enum", values: ["noop"] },
          continuation: { kind: "enum", values: ["noop"] },
          args: { kind: "record", fields: {} },
        },
      },
      maxLen,
    },
    origin: "system",
    scope: { kind: "global" },
    role: { kind: "pending-queue" },
    initial: [],
  };
}

function modelIdDecl(
  values: readonly string[],
  initial: string | readonly string[],
): StateVarDecl {
  return {
    id: "corpus:model",
    domain: { kind: "enum", values },
    origin: "system",
    scope: { kind: "global" },
    initial,
  };
}

function lit(value: Value): ExprIR {
  return { kind: "lit", value };
}

function read(id: string): ExprIR {
  return { kind: "read", var: id };
}

function eq(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "eq", args: [left, right] };
}

function and(...args: ExprIR[]): ExprIR {
  return { kind: "and", args };
}

function assign(
  variable: string,
  value: Value,
): Extract<Transition["effect"], { kind: "assign" }> {
  return { kind: "assign", var: variable, expr: lit(value) };
}

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const raw = process.argv[index + 1];
  if (!raw) throw new Error(`Missing value for ${name}`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function porParityModel(): Model {
  const route = routeDecl();
  return {
    schemaVersion: 1,
    id: "por-parity",
    bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      route,
      historyDecl(route.domain),
      pendingDecl(0),
      {
        id: "a",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
      {
        id: "b",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "flipA",
        cls: "user",
        label: { kind: "click", text: "A" },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "a" }] },
        effect: {
          kind: "assign",
          var: "a",
          expr: { kind: "lit", value: true },
        },
        reads: ["a"],
        writes: ["a"],
        confidence: "exact",
      },
      {
        id: "flipB",
        cls: "user",
        label: { kind: "click", text: "B" },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "b" }] },
        effect: {
          kind: "assign",
          var: "b",
          expr: { kind: "lit", value: true },
        },
        reads: ["b"],
        writes: ["b"],
        confidence: "exact",
      },
    ],
  };
}

function assertPorParity(
  label: string,
  withoutPor: ReturnType<typeof checkModel>,
  withPor: ReturnType<typeof checkModel>,
): void {
  if (
    withoutPor.verdicts.map((verdict) => verdict.status).join(",") !==
    withPor.verdicts.map((verdict) => verdict.status).join(",")
  ) {
    throw new Error(`${label} verdict mismatch`);
  }
  if (withPor.diagnostics?.partialOrderReduction?.enabled !== true) {
    throw new Error(`${label} expected POR to be enabled`);
  }
}

function assertEqual(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: actual=${actual} expected=${expected}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
