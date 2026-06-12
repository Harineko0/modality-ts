import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseModelArtifact } from "@modality/kernel";
import type { EffectIR, ExprIR, Model, Transition, Value } from "@modality/kernel";

export interface ExportTlaCommandOptions {
  modelPath: string;
  outPath: string;
  moduleName?: string;
}

export interface ExportTlaCommandResult {
  lines: string[];
  source: string;
}

export async function runExportTlaCommand(options: ExportTlaCommandOptions): Promise<ExportTlaCommandResult> {
  const model = parseModelArtifact(await readFile(options.modelPath, "utf8"));
  const source = generateTlaModule(model, options.moduleName ?? tlaModuleName(model.id));
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, source, "utf8");
  return { source, lines: [`export=${options.outPath}`, `format=tla`] };
}

export function generateTlaModule(model: Model, moduleName = tlaModuleName(model.id)): string {
  const vars = model.vars.map((decl) => tlaName(decl.id));
  const actions = model.transitions.map((transition) => tlaAction(model, transition));
  return [
    `---- MODULE ${moduleName} ----`,
    `EXTENDS Naturals, Sequences, TLC`,
    ``,
    `VARIABLES ${vars.join(", ")}`,
    ``,
    `Init ==`,
    indent(model.vars.map((decl) => `${tlaName(decl.id)} = ${tlaValue(decl.initial as Value)}`).join(" /\\\n")),
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

function tlaAction(model: Model, transition: Transition): string {
  const assignments = effectAssignments(transition.effect);
  const assigned = new Set(assignments.map((assignment) => assignment.var));
  const unchanged = model.vars.map((decl) => decl.id).filter((id) => !assigned.has(id));
  return [
    `${tlaName(transition.id)} ==`,
    indent([
      tlaExpr(transition.guard),
      ...assignments.map((assignment) => `${tlaName(assignment.var)}' = ${tlaExpr(assignment.expr)}`),
      unchanged.length > 0 ? `UNCHANGED <<${unchanged.map(tlaName).join(", ")}>>` : undefined
    ].filter((line): line is string => Boolean(line)).join(" /\\\n"))
  ].join("\n");
}

function effectAssignments(effect: EffectIR): { var: string; expr: ExprIR }[] {
  switch (effect.kind) {
    case "assign":
      return [{ var: effect.var, expr: effect.expr }];
    case "seq":
      return effect.effects.flatMap(effectAssignments);
    default:
      throw new Error(`TLA export does not support effect kind ${effect.kind}`);
  }
}

function tlaExpr(expr: ExprIR): string {
  switch (expr.kind) {
    case "lit":
      return tlaValue(expr.value);
    case "read":
      if (expr.path && expr.path.length > 0) throw new Error("TLA export does not support read paths yet");
      return tlaName(expr.var);
    case "eq":
      return `(${tlaExpr(expr.args[0])} = ${tlaExpr(expr.args[1])})`;
    case "neq":
      return `(${tlaExpr(expr.args[0])} # ${tlaExpr(expr.args[1])})`;
    case "and":
      return expr.args.map(tlaExpr).join(" /\\ ");
    case "or":
      return expr.args.map(tlaExpr).join(" \\/ ");
    case "not":
      return `~(${tlaExpr(expr.args[0])})`;
    default:
      throw new Error(`TLA export does not support expression kind ${expr.kind}`);
  }
}

function tlaValue(value: Value): string {
  if (value === null) return `"null"`;
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `<<${value.map(tlaValue).join(", ")}>>`;
  return `[${Object.entries(value).map(([key, item]) => `${tlaName(key)} |-> ${tlaValue(item)}`).join(", ")}]`;
}

function tlaName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

function tlaModuleName(value: string): string {
  const name = tlaName(value).replace(/^_+/, "");
  return name ? `${name}_Model` : "ModalityModel";
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
