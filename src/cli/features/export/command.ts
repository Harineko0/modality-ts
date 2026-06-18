import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  enumerateDomain,
  initialValues,
  parseModelArtifact,
  validateModel,
} from "modality-ts/core";
import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  Model,
  NumericOverflowPolicy,
  StateVarDecl,
  Transition,
  Value,
} from "modality-ts/core";

export interface ExportTlaCommandOptions {
  modelPath: string;
  outPath: string;
  moduleName?: string;
}

export interface ExportTlaCommandResult {
  lines: string[];
  source: string;
  moduleName: string;
  outPath: string;
}

export interface TlaStructuredModel {
  moduleName: string;
  variables: readonly string[];
  init: readonly TlaInitialAssignment[];
  transitions: readonly TlaStructuredTransition[];
}

export interface TlaInitialAssignment {
  id: string;
  name: string;
  values: readonly Value[];
  predicate: string;
}

export interface TlaStructuredTransition {
  id: string;
  name: string;
  guard: string;
  branches: readonly TlaStructuredBranch[];
}

export interface TlaStructuredBranch {
  assumptions: readonly string[];
  exists: readonly { name: string; set: string }[];
  next: Readonly<Record<string, string>>;
  relation: string;
}

export async function runExportTlaCommand(
  options: ExportTlaCommandOptions,
): Promise<ExportTlaCommandResult> {
  const model = parseModelArtifact(await readFile(options.modelPath, "utf8"));
  const moduleName = options.moduleName ?? tlaModuleName(model.id);
  const source = generateTlaModule(model, moduleName);
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, source, "utf8");
  return {
    source,
    moduleName,
    outPath: options.outPath,
    lines: [`export=${options.outPath}`, `format=tla`],
  };
}

export function generateTlaModule(
  model: Model,
  moduleName = tlaModuleName(model.id),
): string {
  const validation = validateModel(model);
  if (!validation.ok) {
    throw new Error(
      `Cannot export invalid model: ${validation.errors.join("; ")}`,
    );
  }
  validateTlaIdentifiers(model);
  const vars = model.vars.map((decl) => tlaName(decl.id));
  const actions = model.transitions.map((transition) =>
    tlaAction(model, transition),
  );
  const modHelper = modelUsesTlaMod(model)
    ? [`Mod(a, b) == IF b = 0 THEN 0 ELSE a - b * (a \\div b)`, ``]
    : [];
  return [
    `---- MODULE ${moduleName} ----`,
    `EXTENDS Naturals, Sequences, TLC`,
    ``,
    `VARIABLES ${vars.join(", ")}`,
    ``,
    ...modHelper,
    `Init ==`,
    indent(
      model.vars
        .map((decl) =>
          tlaInitial(decl.id, initialValues(decl.domain, decl.initial)),
        )
        .join(" /\\\n"),
    ),
    ``,
    ...actions.flatMap((action) => [action, ``]),
    `Next ==`,
    indent(
      model.transitions
        .map((transition) => tlaName(transition.id))
        .join(" \\/\n"),
    ),
    ``,
    `Spec == Init /\\ [][Next]_<<${vars.join(", ")}>>`,
    ``,
    `====`,
    ``,
  ].join("\n");
}

export function generateTlaStructuredModel(
  model: Model,
  moduleName = tlaModuleName(model.id),
): TlaStructuredModel {
  const validation = validateModel(model);
  if (!validation.ok) {
    throw new Error(
      `Cannot export invalid model: ${validation.errors.join("; ")}`,
    );
  }
  validateTlaIdentifiers(model);
  return {
    moduleName,
    variables: model.vars.map((decl) => tlaName(decl.id)),
    init: model.vars.map((decl) => {
      const values = initialValues(decl.domain, decl.initial);
      return {
        id: decl.id,
        name: tlaName(decl.id),
        values,
        predicate: tlaInitial(decl.id, values),
      };
    }),
    transitions: model.transitions.map((transition) => ({
      id: transition.id,
      name: tlaName(transition.id),
      guard: tlaExpr(transition.guard),
      branches: effectBranches(model, transition.effect, currentEnv(model)).map(
        (branch) => ({
          assumptions: branch.assumptions,
          exists: branch.exists,
          next: Object.fromEntries(
            model.vars.map((decl) => [decl.id, envValue(branch, decl.id)]),
          ),
          relation: branchRelation(model, branch),
        }),
      ),
    })),
  };
}

function tlaAction(model: Model, transition: Transition): string {
  const relation = effectRelation(model, transition.effect, currentEnv(model));
  return [
    `${tlaName(transition.id)} ==`,
    indent(
      [tlaExpr(transition.guard), relation]
        .filter((line): line is string => Boolean(line))
        .join(" /\\\n"),
    ),
  ].join("\n");
}

interface TlaEnv {
  values: Map<string, string>;
  assumptions: string[];
  exists: { name: string; set: string }[];
  nextId: number;
}

function effectRelation(model: Model, effect: EffectIR, env: TlaEnv): string {
  const branches = effectBranches(model, effect, env);
  if (branches.length === 1) {
    const branch = branches[0];
    if (!branch) return "FALSE";
    return branchRelation(model, branch);
  }
  return `(${branches.map((branch) => `(${branchRelation(model, branch)})`).join(" \\/\n")})`;
}

function effectBranches(model: Model, effect: EffectIR, env: TlaEnv): TlaEnv[] {
  switch (effect.kind) {
    case "assign":
      if (effect.expr.kind === "freshToken")
        return [withFreshToken(model, env, effect.var, effect.expr.domainOf)];
      {
        const decl = model.vars.find(
          (candidate) => candidate.id === effect.var,
        );
        const exprTla = tlaExpr(effect.expr, env);
        if (decl && isNumericDomain(decl.domain)) {
          return [
            withNumericAssign(
              env,
              effect.var,
              exprTla,
              decl.domain as Extract<
                AbstractDomain,
                { kind: "boundedInt" } | { kind: "intSet" }
              >,
            ),
          ];
        }
        return [withValue(env, effect.var, exprTla)];
      }
    case "havoc": {
      const decl = model.vars.find((candidate) => candidate.id === effect.var);
      if (!decl)
        throw new Error(`TLA export cannot havoc unknown var ${effect.var}`);
      return [withExistentialValue(env, effect.var, tlaDomainSet(decl.domain))];
    }
    case "choose":
      return effect.among.map((expr) =>
        withValue(env, effect.var, tlaExpr(expr, env)),
      );
    case "if":
      return [
        ...effectBranches(
          model,
          effect.then,
          envWithAssumption(env, tlaExpr(effect.cond, env)),
        ),
        ...effectBranches(
          model,
          effect.else,
          envWithAssumption(env, `~(${tlaExpr(effect.cond, env)})`),
        ),
      ];
    case "seq":
      return effect.effects.reduce<TlaEnv[]>(
        (branches, next) =>
          branches.flatMap((branch) => effectBranches(model, next, branch)),
        [env],
      );
    case "enqueue": {
      const queueId = resolvePendingQueueId(model, effect.queue);
      const pending = envValue(env, queueId);
      const args = tlaRecord(
        Object.fromEntries(
          Object.entries(effect.args).map(([key, expr]) => [
            key,
            tlaExpr(expr, env),
          ]),
        ),
      );
      const op = tlaRecord({
        opId: tlaValue(effect.op),
        continuation: tlaValue(effect.continuation),
        args,
      });
      return [
        withValue(
          envWithAssumption(
            env,
            `(Len(${pending}) < ${model.bounds.maxPending})`,
          ),
          queueId,
          `Append(${pending}, ${op})`,
        ),
      ];
    }
    case "dequeue": {
      const queueId = resolvePendingQueueId(model, effect.queue);
      const pending = envValue(env, queueId);
      return [
        withValue(
          env,
          queueId,
          `SubSeq(${pending}, 1, ${effect.index}) \\o SubSeq(${pending}, ${effect.index + 2}, Len(${pending}))`,
        ),
      ];
    }
    case "opaque":
      return opaqueBranches(model, effect, env);
    default:
      throw new Error("TLA export encountered an unsupported effect kind");
  }
}

function opaqueBranches(
  model: Model,
  effect: Extract<EffectIR, { kind: "opaque" }>,
  env: TlaEnv,
): TlaEnv[] {
  let next = cloneEnv(env);
  for (const id of effect.ref.declaredWrites) {
    const decl = model.vars.find((candidate) => candidate.id === id);
    if (!decl)
      throw new Error(`TLA export cannot havoc unknown opaque write ${id}`);
    next = withExistentialValue(next, id, tlaDomainSet(decl.domain));
  }
  return [next];
}

function branchRelation(model: Model, env: TlaEnv): string {
  const assumptions =
    env.assumptions.length > 0 ? env.assumptions.join(" /\\\n") : undefined;
  const assignments = model.vars.map(
    (decl) => `${tlaName(decl.id)}' = ${envValue(env, decl.id)}`,
  );
  const relation = [assumptions, ...assignments]
    .filter((item): item is string => Boolean(item))
    .join(" /\\\n");
  if (env.exists.length === 0) return relation;
  return `\\E ${env.exists.map((item) => `${item.name} \\in ${item.set}`).join(", ")}:\n${indent(relation)}`;
}

function currentEnv(model: Model): TlaEnv {
  return {
    values: new Map(model.vars.map((decl) => [decl.id, tlaName(decl.id)])),
    assumptions: [],
    exists: [],
    nextId: 0,
  };
}

function emptyEnv(): TlaEnv {
  return { values: new Map(), assumptions: [], exists: [], nextId: 0 };
}

function envWithAssumption(env: TlaEnv, assumption: string): TlaEnv {
  return {
    ...env,
    values: new Map(env.values),
    assumptions: [...env.assumptions, assumption],
    exists: [...env.exists],
  };
}

function cloneEnv(env: TlaEnv): TlaEnv {
  return {
    values: new Map(env.values),
    assumptions: [...env.assumptions],
    exists: [...env.exists],
    nextId: env.nextId,
  };
}

function withValue(env: TlaEnv, id: string, value: string): TlaEnv {
  const next = cloneEnv(env);
  next.values.set(id, value);
  return next;
}

function withExistentialValue(env: TlaEnv, id: string, set: string): TlaEnv {
  const next = cloneEnv(env);
  const name = `${tlaName(id)}_choice_${next.nextId + 1}`;
  next.nextId += 1;
  next.exists.push({ name, set });
  next.values.set(id, name);
  return next;
}

function withFreshToken(
  model: Model,
  env: TlaEnv,
  target: string,
  domainOf: string,
): TlaEnv {
  const decl = model.vars.find((candidate) => candidate.id === domainOf);
  if (decl?.domain.kind !== "tokens")
    throw new Error(`TLA export cannot freshToken non-token var ${domainOf}`);
  const next = cloneEnv(env);
  const name = `${tlaName(target)}_fresh_${next.nextId + 1}`;
  next.nextId += 1;
  next.exists.push({ name, set: tlaSet(enumerateDomain(decl.domain)) });
  next.assumptions.push(freshTokenAssumption(model, env, name));
  next.values.set(target, name);
  return next;
}

function freshTokenAssumption(
  model: Model,
  env: TlaEnv,
  tokenName: string,
): string {
  const clauses = model.vars.map((decl) =>
    tokenAbsentExpr(decl.domain, envValue(env, decl.id), tokenName),
  );
  return clauses.length === 0 ? "TRUE" : clauses.join(" /\\ ");
}

function tokenAbsentExpr(
  domain: Model["vars"][number]["domain"],
  valueExpr: string,
  tokenName: string,
): string {
  switch (domain.kind) {
    case "tokens":
      return `(${valueExpr} # ${tokenName})`;
    case "option":
      return `((${valueExpr} = "null") \\/ ${tokenAbsentExpr(domain.inner, valueExpr, tokenName)})`;
    case "record": {
      const clauses = Object.entries(domain.fields).map(
        ([field, fieldDomain]) =>
          tokenAbsentExpr(
            fieldDomain,
            `${valueExpr}.${tlaName(field)}`,
            tokenName,
          ),
      );
      return clauses.length === 0 ? "TRUE" : `(${clauses.join(" /\\ ")})`;
    }
    case "tagged": {
      const fieldNames = new Set<string>();
      for (const variant of Object.values(domain.variants)) {
        if (variant.kind === "record")
          for (const field of Object.keys(variant.fields))
            fieldNames.add(field);
      }
      const clauses = [...fieldNames].map((field) => {
        const fieldDomain =
          Object.values(domain.variants)
            .filter(
              (
                variant,
              ): variant is Extract<typeof variant, { kind: "record" }> =>
                variant.kind === "record",
            )
            .map((variant) => variant.fields[field])
            .find((candidate): candidate is Model["vars"][number]["domain"] =>
              Boolean(candidate),
            ) ?? ({ kind: "enum", values: [] } as const);
        return tokenAbsentExpr(
          fieldDomain,
          `${valueExpr}.${tlaName(field)}`,
          tokenName,
        );
      });
      return clauses.length === 0 ? "TRUE" : `(${clauses.join(" /\\ ")})`;
    }
    case "boundedList":
      return `(\\A i \\in 1..Len(${valueExpr}): ${tokenAbsentExpr(domain.inner, `${valueExpr}[i]`, tokenName)})`;
    default:
      return "TRUE";
  }
}

function envValue(env: TlaEnv, id: string): string {
  return env.values.get(id) ?? tlaName(id);
}

function tlaExpr(expr: ExprIR, env: TlaEnv = emptyEnv()): string {
  switch (expr.kind) {
    case "lit":
      return tlaValue(expr.value);
    case "read":
      return tlaRead(envValue(env, expr.var), expr.path ?? []);
    case "eq":
      return `(${tlaExpr(expr.args[0], env)} = ${tlaExpr(expr.args[1], env)})`;
    case "neq":
      return `(${tlaExpr(expr.args[0], env)} # ${tlaExpr(expr.args[1], env)})`;
    case "and":
      return expr.args.map((arg) => tlaExpr(arg, env)).join(" /\\ ");
    case "or":
      return expr.args.map((arg) => tlaExpr(arg, env)).join(" \\/ ");
    case "not":
      return `~(${tlaExpr(expr.args[0], env)})`;
    case "cond":
      return `(IF ${tlaExpr(expr.args[0], env)} THEN ${tlaExpr(expr.args[1], env)} ELSE ${tlaExpr(expr.args[2], env)})`;
    case "updateField":
      return `[${tlaExpr(expr.target, env)} EXCEPT ${tlaPath(expr.path)} = ${tlaExpr(expr.value, env)}]`;
    case "tagIs":
      return `(\\E value \\in DOMAIN ${tlaExpr(expr.arg, env)}: ${tlaExpr(expr.arg, env)}[value] = ${tlaValue(expr.tag)})`;
    case "lenCat":
      return `(IF Len(${tlaExpr(expr.arg, env)}) = 0 THEN "0" ELSE IF Len(${tlaExpr(expr.arg, env)}) = 1 THEN "1" ELSE "many")`;
    case "freshToken":
      throw new Error(
        "TLA export only supports freshToken as an assignment expression",
      );
    case "lt":
      return `(${tlaExpr(expr.args[0], env)} < ${tlaExpr(expr.args[1], env)})`;
    case "lte":
      return `(${tlaExpr(expr.args[0], env)} <= ${tlaExpr(expr.args[1], env)})`;
    case "gt":
      return `(${tlaExpr(expr.args[0], env)} > ${tlaExpr(expr.args[1], env)})`;
    case "gte":
      return `(${tlaExpr(expr.args[0], env)} >= ${tlaExpr(expr.args[1], env)})`;
    case "add":
      return `(${tlaExpr(expr.args[0], env)} + ${tlaExpr(expr.args[1], env)})`;
    case "sub":
      return `(${tlaExpr(expr.args[0], env)} - ${tlaExpr(expr.args[1], env)})`;
    case "mod":
      return `Mod(${tlaExpr(expr.args[0], env)}, ${tlaExpr(expr.args[1], env)})`;
    default:
      throw new Error("TLA export encountered an unsupported expression kind");
  }
}

function tlaValue(value: Value): string {
  if (value === null) return `"null"`;
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `<<${value.map(tlaValue).join(", ")}>>`;
  return tlaRecord(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, tlaValue(item)]),
    ),
  );
}

function validateTlaIdentifiers(model: Model): void {
  const seen = new Map<string, string>();
  for (const id of [
    ...model.vars.map((decl) => decl.id),
    ...model.transitions.map((transition) => transition.id),
  ]) {
    const name = tlaName(id);
    const previous = seen.get(name);
    if (previous && previous !== id) {
      throw new Error(
        `TLA export identifier collision: ${previous} and ${id} both map to ${name}`,
      );
    }
    seen.set(name, id);
  }
}

function tlaInitial(id: string, values: readonly Value[]): string {
  if (values.length === 1) {
    const value = values[0];
    if (value === undefined) return `${tlaName(id)} \\in ${tlaSet(values)}`;
    return `${tlaName(id)} = ${tlaValue(value)}`;
  }
  return `${tlaName(id)} \\in ${tlaSet(values)}`;
}

function tlaSet(values: readonly Value[]): string {
  return `{${values.map(tlaValue).join(", ")}}`;
}

function isNumericDomain(
  domain: AbstractDomain,
): domain is Extract<AbstractDomain, { kind: "boundedInt" | "intSet" }> {
  return domain.kind === "boundedInt" || domain.kind === "intSet";
}

function tlaDomainSet(domain: AbstractDomain): string {
  switch (domain.kind) {
    case "boundedInt": {
      const span = domain.max - domain.min + 1;
      if (span <= 64) {
        return `{${Array.from({ length: span }, (_, index) => domain.min + index).join(", ")}}`;
      }
      return `{n \\in Nat : n >= ${domain.min} /\\ n <= ${domain.max}}`;
    }
    case "intSet":
      return `{${domain.values.join(", ")}}`;
    default:
      return tlaSet(enumerateDomain(domain));
  }
}

function withNumericAssign(
  env: TlaEnv,
  id: string,
  rawExpr: string,
  domain: Extract<AbstractDomain, { kind: "boundedInt" } | { kind: "intSet" }>,
): TlaEnv {
  const policy = domain.overflow ?? "forbid";
  let next = withValue(env, id, tlaNumericAssignExpr(rawExpr, domain, policy));
  if (policy === "forbid") {
    next = envWithAssumption(next, tlaNumericMembership(rawExpr, domain));
  }
  return next;
}

function tlaNumericMembership(
  rawExpr: string,
  domain: Extract<AbstractDomain, { kind: "boundedInt" } | { kind: "intSet" }>,
): string {
  return `(${rawExpr} \\in ${tlaDomainSet(domain)})`;
}

function tlaNumericAssignExpr(
  rawExpr: string,
  domain: Extract<AbstractDomain, { kind: "boundedInt" } | { kind: "intSet" }>,
  policy: NumericOverflowPolicy,
): string {
  if (policy === "forbid") return rawExpr;
  if (domain.kind === "boundedInt") {
    const span = domain.max - domain.min + 1;
    if (policy === "wrap") {
      return `((${domain.min} + Mod(Mod((${rawExpr} - ${domain.min}), ${span}) + ${span}, ${span})))`;
    }
    return `(IF ${rawExpr} < ${domain.min} THEN ${domain.min} ELSE IF ${rawExpr} > ${domain.max} THEN ${domain.max} ELSE ${rawExpr})`;
  }
  const min = domain.values[0] ?? 0;
  const max = domain.values[domain.values.length - 1] ?? min;
  if (policy === "wrap") {
    const set = tlaDomainSet(domain);
    const len = domain.values.length;
    return `(LET idx == Mod(Mod(${rawExpr}, ${len}) + ${len}, ${len}) IN ${tlaIntSetIndexExpr(set, "idx", domain.values)})`;
  }
  return `(IF ${rawExpr} < ${min} THEN ${min} ELSE IF ${rawExpr} > ${max} THEN ${max} ELSE ${rawExpr})`;
}

function tlaIntSetIndexExpr(
  _set: string,
  indexExpr: string,
  values: readonly number[],
): string {
  if (values.length === 0) return "0";
  if (values.length === 1) return String(values[0]);
  const branches = values
    .map((value, index) => `IF ${indexExpr} = ${index} THEN ${value}`)
    .join(" ELSE ");
  return `(${branches} ELSE ${values[values.length - 1]})`;
}

function modelUsesTlaMod(model: Model): boolean {
  const varsById = new Map(model.vars.map((decl) => [decl.id, decl]));
  for (const transition of model.transitions) {
    if (effectUsesTlaMod(transition.effect, varsById)) return true;
  }
  return false;
}

function effectUsesTlaMod(
  effect: EffectIR,
  varsById: Map<string, StateVarDecl>,
): boolean {
  switch (effect.kind) {
    case "assign": {
      if (exprUsesMod(effect.expr)) return true;
      const decl = varsById.get(effect.var);
      if (!decl || !isNumericDomain(decl.domain)) return false;
      return (decl.domain.overflow ?? "forbid") === "wrap";
    }
    case "if":
      return (
        exprUsesMod(effect.cond) ||
        effectUsesTlaMod(effect.then, varsById) ||
        effectUsesTlaMod(effect.else, varsById)
      );
    case "seq":
      return effect.effects.some((child) => effectUsesTlaMod(child, varsById));
    default:
      return false;
  }
}

function exprUsesMod(expr: ExprIR): boolean {
  if (expr.kind === "mod") return true;
  if ("args" in expr && Array.isArray(expr.args)) {
    return expr.args.some(exprUsesMod);
  }
  if (expr.kind === "not") return exprUsesMod(expr.args[0]);
  if (expr.kind === "updateField") {
    return exprUsesMod(expr.target) || exprUsesMod(expr.value);
  }
  if (expr.kind === "tagIs" || expr.kind === "lenCat") {
    return exprUsesMod(expr.arg);
  }
  if (expr.kind === "cond") {
    return expr.args.some(exprUsesMod);
  }
  return false;
}

function tlaName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

function tlaRead(base: string, path: readonly string[]): string {
  const [segment, ...rest] = path;
  if (segment === undefined) return base;
  if (/^\d+$/.test(segment)) {
    const index = Number(segment) + 1;
    return `(IF Len(${base}) >= ${index} THEN ${tlaRead(`${base}[${index}]`, rest)} ELSE "__modality_oob__")`;
  }
  return tlaRead(`${base}.${tlaName(segment)}`, rest);
}

function tlaPath(path: readonly string[]): string {
  return path
    .map((segment) =>
      /^\d+$/.test(segment)
        ? `![${Number(segment) + 1}]`
        : `!.${tlaName(segment)}`,
    )
    .join("");
}

function resolvePendingQueueId(
  model: Model,
  explicitQueue: string | undefined,
): string {
  if (explicitQueue !== undefined) {
    const decl = model.vars.find((candidate) => candidate.id === explicitQueue);
    if (!decl || decl.role?.kind !== "pending-queue") {
      throw new Error(
        `TLA export pending queue ${explicitQueue} is not a pending-queue role var`,
      );
    }
    return explicitQueue;
  }
  const queues = model.vars.filter((decl) => decl.role?.kind === "pending-queue");
  if (queues.length === 1) {
    const queue = queues[0];
    if (!queue) throw new Error("TLA export missing pending-queue role var");
    return queue.id;
  }
  if (queues.length === 0) {
    throw new Error("TLA export enqueue/dequeue requires a pending-queue role var");
  }
  throw new Error(
    "TLA export enqueue/dequeue queue is ambiguous; specify queue explicitly",
  );
}

function tlaRecord(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return `[__empty |-> TRUE]`;
  return `[${entries.map(([key, item]) => `${tlaName(key)} |-> ${item}`).join(", ")}]`;
}

function tlaModuleName(value: string): string {
  const name = tlaName(value).replace(/^_+/, "");
  return name ? `${name}_Model` : "ModalityModel";
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
