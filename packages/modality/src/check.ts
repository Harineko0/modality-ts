import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { checkModel, type CheckResult, type PropertyVerdict } from "@modality/checker";
import { canonicalJson, type CheckReport, type Model, type Property } from "@modality/kernel";
import { loadAndApplyOverlay } from "./overlay.js";

export interface CheckCommandOptions {
  modelPath: string;
  propsPath?: string;
  reportPath?: string;
  overlayPath?: string;
  now?: Date;
}

export interface CheckCommandResult {
  check: CheckResult;
  report: CheckReport;
  exitCode: number;
  lines: string[];
}

export async function runCheckCommand(options: CheckCommandOptions): Promise<CheckCommandResult> {
  const loadedModel = JSON.parse(await readFile(options.modelPath, "utf8")) as Model;
  const overlay = await loadAndApplyOverlay(loadedModel, options.overlayPath);
  if (overlay.errors.length > 0) {
    throw new Error(`Overlay merge failed: ${overlay.errors.join("; ")}`);
  }
  const model = overlay.model;
  const properties = await loadProperties(model, options.propsPath);
  const check = checkModel(model, properties);
  const report = createCheckReport(model, check, options.now ?? new Date(), overlay.warnings);
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  return {
    check,
    report,
    exitCode: check.verdicts.some((verdict) => verdict.status === "violated" || verdict.status === "error") ? 2 : 0,
    lines: renderCheckResult(check)
  };
}

export function createCheckReport(model: Model, check: CheckResult, now: Date, overlayWarnings: readonly string[] = []): CheckReport {
  return {
    schemaVersion: 1,
    kind: "check-report",
    modelId: model.id,
    generatedAt: now.toISOString(),
    verdicts: check.verdicts.map(reportVerdict),
    stats: check.stats,
    vacuityWarnings: [...check.vacuityWarnings, ...overlayWarnings].sort(),
    trustLedger: {
      bounds: model.bounds,
      assumptions: [],
      abstractions: model.vars
        .filter((decl) => decl.domain.kind === "tokens" || decl.domain.kind === "lengthCat")
        .map((decl) => `${decl.id}:${decl.domain.kind}`),
      manualTransitions: model.transitions.filter((transition) => transition.confidence === "manual").map((transition) => transition.id),
      overApproxTransitions: model.transitions.filter((transition) => transition.confidence === "over-approx").map((transition) => transition.id),
      boundHits: []
    }
  };
}

export function renderCheckResult(check: CheckResult): string[] {
  const lines: string[] = [];
  for (const verdict of check.verdicts) {
    lines.push(`${verdict.property}: ${verdict.status}`);
    if (verdict.status === "violated" || verdict.status === "reachable") {
      lines.push(`  trace steps: ${verdict.trace.steps.map((step) => step.transitionId).join(" -> ") || "(initial)"}`);
    }
    if (verdict.status === "error" || verdict.status === "vacuous-warning") {
      lines.push(`  ${verdict.message}`);
    }
  }
  lines.push(`states=${check.stats.states} edges=${check.stats.edges} depth=${check.stats.depth}`);
  return lines;
}

async function loadProperties(model: Model, propsPath: string | undefined): Promise<Property[]> {
  if (!propsPath) return [];
  const module = (await import(pathToFileURL(propsPath).href)) as {
    properties?: Property[] | ((model: Model) => Property[]);
    propertiesFor?: (model: Model) => Property[];
  };
  if (typeof module.propertiesFor === "function") return module.propertiesFor(model);
  if (typeof module.properties === "function") return module.properties(model);
  return module.properties ?? [];
}

function reportVerdict(verdict: PropertyVerdict): CheckReport["verdicts"][number] {
  if (verdict.status === "violated" || verdict.status === "reachable") {
    return { property: verdict.property, status: verdict.status, trace: verdict.trace };
  }
  if (verdict.status === "error" || verdict.status === "vacuous-warning") {
    return { property: verdict.property, status: verdict.status, message: verdict.message };
  }
  return { property: verdict.property, status: verdict.status };
}
