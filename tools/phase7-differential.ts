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

function assertEqual(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: actual=${actual} expected=${expected}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
