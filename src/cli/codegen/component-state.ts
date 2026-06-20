import { dirname, join, parse } from "node:path";
import type {
  AbstractDomain,
  Model,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import { quoteProperty, stringLiteralType } from "./model.js";
import { assignTransitionHandleNames } from "./transition-handles.js";

interface LocalField {
  componentId: string;
  field: string;
  domain: AbstractDomain;
}

interface TransitionEntry {
  name: string;
  transitionId: string;
}

export interface ComponentModalModule {
  sourcePath?: string;
  fileName: string;
  path: string;
  source: string;
}

function componentAndField(
  varId: string,
): { componentId: string; field: string } | undefined {
  if (!varId.startsWith("local:")) return undefined;
  const rest = varId.slice("local:".length);
  const dot = rest.indexOf(".");
  if (dot < 0) return undefined;
  return {
    componentId: rest.slice(0, dot),
    field: rest.slice(dot + 1),
  };
}

function modulePathForSource(sourcePath: string): string {
  const parsed = parse(sourcePath);
  return join(parsed.dir, `${parsed.name}.modals.ts`);
}

function fallbackModulePath(appModelPath: string, componentId: string): string {
  return join(componentModalsDir(appModelPath), `${componentId}.modals.ts`);
}

function sourcePathForLocalVar(decl: StateVarDecl): string | undefined {
  return typeof decl.origin === "object" ? decl.origin.file : undefined;
}

function localFieldsByModule(
  model: Model,
  appModelPath: string,
): Map<string, { sourcePath?: string; fields: LocalField[] }> {
  const byModule = new Map<
    string,
    { sourcePath?: string; fields: LocalField[] }
  >();
  for (const decl of model.vars) {
    const parsed = componentAndField(decl.id);
    if (!parsed) continue;
    const sourcePath = sourcePathForLocalVar(decl);
    const path = sourcePath
      ? modulePathForSource(sourcePath)
      : fallbackModulePath(appModelPath, parsed.componentId);
    const entry = byModule.get(path) ?? {
      ...(sourcePath ? { sourcePath } : {}),
      fields: [],
    };
    entry.fields.push({
      componentId: parsed.componentId,
      field: parsed.field,
      domain: decl.domain,
    });
    byModule.set(path, entry);
  }
  return byModule;
}

function transitionsByModule(
  model: Model,
): Map<string, { sourcePath?: string; transitions: TransitionEntry[] }> {
  const grouped = new Map<
    string,
    { sourcePath?: string; transitions: Transition[] }
  >();
  for (const transition of model.transitions) {
    const sourcePath = transition.source[0]?.file;
    if (!sourcePath) continue;
    const path = modulePathForSource(sourcePath);
    const entry = grouped.get(path) ?? { sourcePath, transitions: [] };
    entry.transitions.push(transition);
    grouped.set(path, entry);
  }

  const byModule = new Map<
    string,
    { sourcePath?: string; transitions: TransitionEntry[] }
  >();
  for (const [path, entry] of grouped) {
    const named = assignTransitionHandleNames(entry.transitions);
    byModule.set(path, {
      ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
      transitions: named.map(({ transition, name }) => ({
        name,
        transitionId: transition.id,
      })),
    });
  }
  return byModule;
}

function handleType(domain: AbstractDomain, varId: string): string {
  return `Variable<${domainLiteral(domain)}, ${stringLiteralType(varId)}>`;
}

function transitionHandleType(transitionId: string): string {
  return `TransitionRef<${stringLiteralType(transitionId)}>`;
}

function collisionSafeExportName(
  entry: LocalField,
  fieldCounts: ReadonlyMap<string, number>,
): string {
  return (fieldCounts.get(entry.field) ?? 0) > 1
    ? `${entry.componentId}_${entry.field}`
    : entry.field;
}

function domainLiteral(domain: AbstractDomain): string {
  switch (domain.kind) {
    case "bool":
      return '{ readonly kind: "bool" }';
    case "enum":
      return `{ readonly kind: "enum"; readonly values: readonly [${domain.values.map(stringLiteralType).join(", ")}] }`;
    case "boundedInt":
      return `{ readonly kind: "boundedInt"; readonly min: ${domain.min}; readonly max: ${domain.max} }`;
    case "intSet":
      return `{ readonly kind: "intSet"; readonly values: readonly [${domain.values.join(", ")}] }`;
    case "option":
      return `{ readonly kind: "option"; readonly inner: ${domainLiteral(domain.inner)} }`;
    case "record": {
      const fields = Object.entries(domain.fields)
        .map(
          ([key, field]) =>
            `readonly ${quoteProperty(key)}: ${domainLiteral(field)}`,
        )
        .join("; ");
      return `{ readonly kind: "record"; readonly fields: { ${fields} } }`;
    }
    case "tagged": {
      const variants = Object.entries(domain.variants)
        .map(
          ([tag, variant]) =>
            `readonly ${stringLiteralType(tag)}: ${domainLiteral(variant)}`,
        )
        .join("; ");
      return `{ readonly kind: "tagged"; readonly tag: ${stringLiteralType(domain.tag)}; readonly variants: { ${variants} } }`;
    }
    case "tokens":
      return `{ readonly kind: "tokens"; readonly count: ${domain.count} }`;
    case "lengthCat":
      return '{ readonly kind: "lengthCat" }';
    case "boundedList":
      return `{ readonly kind: "boundedList"; readonly inner: ${domainLiteral(domain.inner)}; readonly maxLen: ${domain.maxLen} }`;
  }
}

function emitModuleSource(
  fields: readonly LocalField[],
  transitions: readonly TransitionEntry[],
): string {
  const hasState = fields.length > 0;
  const hasTransitions = transitions.length > 0;
  const lines: string[] = [];

  if (hasState) {
    lines.push('import { variable, type Variable } from "modality-ts/core";');
  }
  if (hasTransitions) {
    lines.push('import type { TransitionRef } from "modality-ts/properties";');
  }
  if (lines.length > 0) {
    lines.push("");
  }

  if (hasState) {
    const sortedFields = [...fields].sort(
      (left, right) =>
        left.field.localeCompare(right.field) ||
        left.componentId.localeCompare(right.componentId),
    );
    const fieldCounts = new Map<string, number>();
    for (const field of sortedFields) {
      fieldCounts.set(field.field, (fieldCounts.get(field.field) ?? 0) + 1);
    }
    lines.push("// state");
    for (const entry of sortedFields) {
      const varId = `local:${entry.componentId}.${entry.field}`;
      lines.push(
        `export const ${collisionSafeExportName(entry, fieldCounts)}: ${handleType(
          entry.domain,
          varId,
        )} = variable(${JSON.stringify(varId)}) as ${handleType(
          entry.domain,
          varId,
        )};`,
      );
    }
  }

  if (hasTransitions) {
    if (hasState) {
      lines.push("");
    }
    lines.push("// transitions");
    const sortedTransitions = [...transitions].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.transitionId.localeCompare(right.transitionId),
    );
    for (const entry of sortedTransitions) {
      const type = transitionHandleType(entry.transitionId);
      lines.push(
        `export const ${entry.name}: ${type} = ${JSON.stringify(entry.transitionId)} as ${type};`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Emit one sibling module per source file that owns `useState` locals and/or transitions. Each
 * module exports state `Variable` handles and transition `TransitionRef` handles so property files
 * can import from `./Component.modals` directly while the loader rewrites imported symbols at check
 * time.
 */
export function emitComponentModalModules(
  model: Model,
  appModelPath: string,
): ComponentModalModule[] {
  const fieldsByModule = localFieldsByModule(model, appModelPath);
  const transitionsByPath = transitionsByModule(model);
  const paths = [
    ...new Set([...fieldsByModule.keys(), ...transitionsByPath.keys()]),
  ].sort((left, right) => left.localeCompare(right));

  const modules: ComponentModalModule[] = [];
  for (const path of paths) {
    const fieldEntry = fieldsByModule.get(path);
    const transitionEntry = transitionsByPath.get(path);
    const fields = fieldEntry?.fields ?? [];
    const transitions = transitionEntry?.transitions ?? [];
    if (fields.length === 0 && transitions.length === 0) continue;
    modules.push({
      ...((fieldEntry?.sourcePath ?? transitionEntry?.sourcePath)
        ? {
            sourcePath: fieldEntry?.sourcePath ?? transitionEntry?.sourcePath,
          }
        : {}),
      fileName: parse(path).base,
      path,
      source: emitModuleSource(fields, transitions),
    });
  }

  return modules;
}

/** Fallback directory (sibling of the app model) for synthetic local modal modules. */
export function componentModalsDir(appModelPath: string): string {
  return join(dirname(appModelPath), "modals");
}
