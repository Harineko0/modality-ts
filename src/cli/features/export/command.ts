import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { enumerateDomain, initialValues, parseModelArtifact, validateModel } from "modality-ts/core";
import type { EffectIR, ExprIR, Model, Transition, Value } from "modality-ts/core";

export interface ExportTlaCommandOptions {
  modelPath: string;
  outPath: string;
  moduleName?: string;
}

export interface ExportTlaCommandResult {
  lines: string[];
  source: string;
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

export async function runExportTlaCommand(options: ExportTlaCommandOptions): Promise<ExportTlaCommandResult> {
  const model = parseModelArtifact(await readFile(options.modelPath, "utf8"));
  const source = generateTlaModule(model, options.moduleName ?? tlaModuleName(model.id));
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, source, "utf8");
  return { source, lines: [`export=${options.outPath}`, `format=tla`] };
}

export function generateTlaModule(model: Model, moduleName = tlaModuleName(model.id)): string {
  const validation = validateModel(model);
  if (!validation.ok) {
    throw new Error(`Cannot export invalid model: ${validation.errors.join("; ")}`);
  }
  validateTlaIdentifiers(model);
  const vars = model.vars.map((decl) => tlaName(decl.id));
  const actions = model.transitions.map((transition) => tlaAction(model, transition));
  return [
    `---- MODULE ${moduleName} ----`,
    `EXTENDS Naturals, Sequences, TLC`,
    ``,
    `VARIABLES ${vars.join(", ")}`,
    ``,
    `Init ==`,
    indent(model.vars.map((decl) => tlaInitial(decl.id, initialValues(decl.domain, decl.initial))).join(" /\\\n")),
    ``,
    ...actions.flatMap((action) => [action, ``]),
    `Next ==`,
    indent(model.transitions.map((transition) => tlaName(transition.id)).join(" \\/\n")),
    ``,
    `Spec == Init /\\ [][Next]_<<${vars.join(", ")}>>`,
    ``,
    `====`,
    ``
  ].join("\n");
}

export function generateTlaStructuredModel(model: Model, moduleName = tlaModuleName(model.id)): TlaStructuredModel {
  const validation = validateModel(model);
  if (!validation.ok) {
    throw new Error(`Cannot export invalid model: ${validation.errors.join("; ")}`);
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
        predicate: tlaInitial(decl.id, values)
      };
    }),
    transitions: model.transitions.map((transition) => ({
      id: transition.id,
      name: tlaName(transition.id),
      guard: tlaExpr(transition.guard),
      branches: effectBranches(model, transition.effect, currentEnv(model)).map((branch) => ({
        assumptions: branch.assumptions,
        exists: branch.exists,
        next: Object.fromEntries(model.vars.map((decl) => [decl.id, envValue(branch, decl.id)])),
        relation: branchRelation(model, branch)
      }))
    }))
  };
}

function tlaAction(model: Model, transition: Transition): string {
  const relation = effectRelation(model, transition.effect, currentEnv(model));
  return [
    `${tlaName(transition.id)} ==`,
    indent([
      tlaExpr(transition.guard),
      relation
    ].filter((line): line is string => Boolean(line)).join(" /\\\n"))
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
  if (branches.length === 1) return branchRelation(model, branches[0]!);
  return `(${branches.map((branch) => `(${branchRelation(model, branch)})`).join(" \\/\n")})`;
}

function effectBranches(model: Model, effect: EffectIR, env: TlaEnv): TlaEnv[] {
  switch (effect.kind) {
    case "assign":
      if (effect.expr.kind === "freshToken") return [withFreshToken(model, env, effect.var, effect.expr.domainOf)];
      return [withValue(env, effect.var, tlaExpr(effect.expr, env))];
    case "havoc": {
      const decl = model.vars.find((candidate) => candidate.id === effect.var);
      if (!decl) throw new Error(`TLA export cannot havoc unknown var ${effect.var}`);
      return [withExistentialValue(env, effect.var, tlaSet(enumerateDomain(decl.domain)))];
    }
    case "choose":
      return effect.among.map((expr) => withValue(env, effect.var, tlaExpr(expr, env)));
    case "if":
      return [
        ...effectBranches(model, effect.then, envWithAssumption(env, tlaExpr(effect.cond, env))),
        ...effectBranches(model, effect.else, envWithAssumption(env, `~(${tlaExpr(effect.cond, env)})`))
      ];
    case "seq":
      return effect.effects.reduce<TlaEnv[]>((branches, next) => branches.flatMap((branch) => effectBranches(model, next, branch)), [env]);
    case "enqueue": {
      const pending = envValue(env, "sys:pending");
      const args = tlaRecord(Object.fromEntries(Object.entries(effect.args).map(([key, expr]) => [key, tlaExpr(expr, env)])));
      const op = tlaRecord({ opId: tlaValue(effect.op), continuation: tlaValue(effect.continuation), args });
      return [withValue(envWithAssumption(env, `(Len(${pending}) < ${model.bounds.maxPending})`), "sys:pending", `Append(${pending}, ${op})`)];
    }
    case "dequeue": {
      const pending = envValue(env, "sys:pending");
      return [withValue(env, "sys:pending", `SubSeq(${pending}, 1, ${effect.index}) \\o SubSeq(${pending}, ${effect.index + 2}, Len(${pending}))`)];
    }
    case "navigate":
      return navigateBranches(model, effect, env);
    case "opaque":
      return opaqueBranches(model, effect, env);
    default:
      throw new Error("TLA export encountered an unsupported effect kind");
  }
}

function navigateBranches(model: Model, effect: Extract<EffectIR, { kind: "navigate" }>, env: TlaEnv): TlaEnv[] {
  const route = envValue(env, "sys:route");
  const history = envValue(env, "sys:history");
  let next = cloneEnv(env);
  if (effect.mode === "back") {
    next = withValue(next, "sys:route", `IF Len(${history}) = 0 THEN ${route} ELSE ${history}[Len(${history})]`);
    next = withValue(next, "sys:history", `IF Len(${history}) = 0 THEN ${history} ELSE SubSeq(${history}, 1, Len(${history}) - 1)`);
  } else {
    const to = effect.to ? tlaExpr(effect.to, env) : route;
    const historyDecl = model.vars.find((decl) => decl.id === "sys:history");
    const historyCap = historyDecl?.domain.kind === "boundedList" ? historyDecl.domain.maxLen : undefined;
    if (effect.mode === "push" && historyCap !== undefined) {
      next = envWithAssumption(next, `(Len(${history}) < ${historyCap})`);
    }
    next = withValue(next, "sys:route", to);
    next = withValue(next, "sys:history", effect.mode === "push" ? `Append(${history}, ${route})` : history);
  }
  for (const decl of model.vars) {
    if (decl.scope.kind !== "route-local") continue;
    next = withValue(next, decl.id, `IF ${envValue(next, "sys:route")} = ${tlaValue(decl.scope.route)} THEN ${tlaValue(decl.initial as Value)} ELSE ${tlaValue("__modality_unmounted__")}`);
  }
  return [next];
}

function opaqueBranches(model: Model, effect: Extract<EffectIR, { kind: "opaque" }>, env: TlaEnv): TlaEnv[] {
  let next = cloneEnv(env);
  for (const id of effect.ref.declaredWrites) {
    const decl = model.vars.find((candidate) => candidate.id === id);
    if (!decl) throw new Error(`TLA export cannot havoc unknown opaque write ${id}`);
    next = withExistentialValue(next, id, tlaSet(enumerateDomain(decl.domain)));
  }
  return [next];
}

function branchRelation(model: Model, env: TlaEnv): string {
  const assumptions = env.assumptions.length > 0 ? env.assumptions.join(" /\\\n") : undefined;
  const assignments = model.vars.map((decl) => `${tlaName(decl.id)}' = ${envValue(env, decl.id)}`);
  const relation = [assumptions, ...assignments].filter((item): item is string => Boolean(item)).join(" /\\\n");
  if (env.exists.length === 0) return relation;
  return `\\E ${env.exists.map((item) => `${item.name} \\in ${item.set}`).join(", ")}:\n${indent(relation)}`;
}

function currentEnv(model: Model): TlaEnv {
  return { values: new Map(model.vars.map((decl) => [decl.id, tlaName(decl.id)])), assumptions: [], exists: [], nextId: 0 };
}

function emptyEnv(): TlaEnv {
  return { values: new Map(), assumptions: [], exists: [], nextId: 0 };
}

function envWithAssumption(env: TlaEnv, assumption: string): TlaEnv {
  return { ...env, values: new Map(env.values), assumptions: [...env.assumptions, assumption], exists: [...env.exists] };
}

function cloneEnv(env: TlaEnv): TlaEnv {
  return { values: new Map(env.values), assumptions: [...env.assumptions], exists: [...env.exists], nextId: env.nextId };
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

function withFreshToken(model: Model, env: TlaEnv, target: string, domainOf: string): TlaEnv {
  const decl = model.vars.find((candidate) => candidate.id === domainOf);
  if (!decl || decl.domain.kind !== "tokens") throw new Error(`TLA export cannot freshToken non-token var ${domainOf}`);
  const next = cloneEnv(env);
  const name = `${tlaName(target)}_fresh_${next.nextId + 1}`;
  next.nextId += 1;
  next.exists.push({ name, set: tlaSet(enumerateDomain(decl.domain)) });
  next.assumptions.push(freshTokenAssumption(model, env, name));
  next.values.set(target, name);
  return next;
}

function freshTokenAssumption(model: Model, env: TlaEnv, tokenName: string): string {
  const clauses = model.vars.map((decl) => tokenAbsentExpr(decl.domain, envValue(env, decl.id), tokenName));
  return clauses.length === 0 ? "TRUE" : clauses.join(" /\\ ");
}

function tokenAbsentExpr(domain: Model["vars"][number]["domain"], valueExpr: string, tokenName: string): string {
  switch (domain.kind) {
    case "tokens":
      return `(${valueExpr} # ${tokenName})`;
    case "option":
      return `((${valueExpr} = "null") \\/ ${tokenAbsentExpr(domain.inner, valueExpr, tokenName)})`;
    case "record": {
      const clauses = Object.entries(domain.fields).map(([field, fieldDomain]) => tokenAbsentExpr(fieldDomain, `${valueExpr}.${tlaName(field)}`, tokenName));
      return clauses.length === 0 ? "TRUE" : `(${clauses.join(" /\\ ")})`;
    }
    case "tagged": {
      const fieldNames = new Set<string>();
      for (const variant of Object.values(domain.variants)) {
        if (variant.kind === "record") for (const field of Object.keys(variant.fields)) fieldNames.add(field);
      }
      const clauses = [...fieldNames].map((field) => {
        const fieldDomain = Object.values(domain.variants)
          .filter((variant): variant is Extract<typeof variant, { kind: "record" }> => variant.kind === "record")
          .map((variant) => variant.fields[field])
          .find((candidate): candidate is Model["vars"][number]["domain"] => Boolean(candidate)) ?? { kind: "enum", values: [] } as const;
        return tokenAbsentExpr(fieldDomain, `${valueExpr}.${tlaName(field)}`, tokenName);
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
      throw new Error("TLA export only supports freshToken as an assignment expression");
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
  return tlaRecord(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tlaValue(item)])));
}

function validateTlaIdentifiers(model: Model): void {
  const seen = new Map<string, string>();
  for (const id of [...model.vars.map((decl) => decl.id), ...model.transitions.map((transition) => transition.id)]) {
    const name = tlaName(id);
    const previous = seen.get(name);
    if (previous && previous !== id) {
      throw new Error(`TLA export identifier collision: ${previous} and ${id} both map to ${name}`);
    }
    seen.set(name, id);
  }
}

function tlaInitial(id: string, values: readonly Value[]): string {
  if (values.length === 1) return `${tlaName(id)} = ${tlaValue(values[0]!)}`;
  return `${tlaName(id)} \\in ${tlaSet(values)}`;
}

function tlaSet(values: readonly Value[]): string {
  return `{${values.map(tlaValue).join(", ")}}`;
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
  return path.map((segment) => (/^\d+$/.test(segment) ? `![${Number(segment) + 1}]` : `!.${tlaName(segment)}`)).join("");
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
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
