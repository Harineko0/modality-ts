import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractUseStateSkeleton } from "@modality/extraction";
import { canonicalJson, type ExtractionReport, type Model, type StateVarDecl } from "@modality/kernel";
import { loadAndApplyOverlay } from "./overlay.js";

export interface ExtractCommandOptions {
  sourcePath: string;
  modelPath: string;
  reportPath?: string;
  route?: string;
  effectApis?: readonly string[];
  overlayPath?: string;
  now?: Date;
}

export interface ExtractCommandResult {
  model: Model;
  report: ExtractionReport;
  lines: string[];
}

export async function runExtractCommand(options: ExtractCommandOptions): Promise<ExtractCommandResult> {
  const source = await readFile(options.sourcePath, "utf8");
  const route = options.route ?? "/";
  const skeleton = extractUseStateSkeleton(source, {
    route,
    fileName: options.sourcePath,
    effectApis: options.effectApis ?? []
  });
  const extractedModel: Model = {
    schemaVersion: 1,
    id: "extracted-model",
    bounds: { maxDepth: 12, maxPending: 3, maxInternalSteps: 16 },
    vars: [...systemVars(route, options.effectApis ?? []), ...skeleton.vars],
    transitions: skeleton.transitions
  };
  const overlay = await loadAndApplyOverlay(extractedModel, options.overlayPath);
  if (overlay.errors.length > 0) {
    throw new Error(`Overlay merge failed: ${overlay.errors.join("; ")}`);
  }
  const model = overlay.model;
  const report = createExtractionReport(options.sourcePath, model, [...skeleton.warnings.map((warning) => warning.message), ...overlay.warnings], options.now ?? new Date());
  await mkdir(dirname(options.modelPath), { recursive: true });
  await writeFile(options.modelPath, `${canonicalJson(model)}\n`, "utf8");
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  return {
    model,
    report,
    lines: [
      `extracted vars=${skeleton.vars.length} transitions=${skeleton.transitions.length}`,
      `model=${options.modelPath}`,
      ...(options.overlayPath ? [`overlay=${options.overlayPath}`] : []),
      ...(options.reportPath ? [`report=${options.reportPath}`] : [])
    ]
  };
}

function createExtractionReport(sourcePath: string, model: Model, warnings: readonly string[], now: Date): ExtractionReport {
  return {
    schemaVersion: 1,
    kind: "extraction-report",
    generatedAt: now.toISOString(),
    sourceFiles: [sourcePath],
    handlers: model.transitions.map((transition) => ({
      id: transition.id,
      classification: transition.confidence === "manual" ? "overlay" : transition.confidence,
      reasons: []
    })),
    domains: model.vars.map((decl) => ({
      varId: decl.id,
      domainKind: decl.domain.kind,
      provenance: decl.origin === "system" ? "system" : decl.origin === "library-template" ? "template" : decl.domain.kind === "tokens" ? "default-token" : "type-derived"
    })),
    warnings
  };
}

function systemVars(route: string, effectApis: readonly string[]): StateVarDecl[] {
  const routeDomain = { kind: "enum" as const, values: [route] };
  const opValues = effectApis.length > 0 ? [...effectApis] : ["noop"];
  const continuationValues = effectApis.length > 0 ? effectApis.flatMap((op) => [`App.onClick.${op}.cont`, `App.onSubmit.${op}.cont`, `App.onChange.${op}.cont`]) : ["noop"];
  return [
    { id: "sys:route", domain: routeDomain, origin: "system", scope: { kind: "global" }, initial: route },
    { id: "sys:history", domain: { kind: "boundedList", inner: routeDomain, maxLen: 4 }, origin: "system", scope: { kind: "global" }, initial: [] },
    {
      id: "sys:pending",
      domain: {
        kind: "boundedList",
        inner: {
          kind: "record",
          fields: {
            opId: { kind: "enum", values: opValues },
            continuation: { kind: "enum", values: continuationValues },
            args: { kind: "record", fields: {} }
          }
        },
        maxLen: 3
      },
      origin: "system",
      scope: { kind: "global" },
      initial: []
    }
  ];
}
