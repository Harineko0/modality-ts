import { dirname, join, parse } from "node:path";
import type { AbstractDomain, Model, StateVarDecl } from "modality-ts/core";
import { quoteProperty, stringLiteralType } from "./model.js";

interface LocalField {
  componentId: string;
  field: string;
  domain: AbstractDomain;
}

export interface ComponentVarModule {
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
  return join(parsed.dir, `${parsed.name}.vars.ts`);
}

function fallbackModulePath(appModelPath: string, componentId: string): string {
  return join(componentVarsDir(appModelPath), `${componentId}.vars.ts`);
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

function handleType(domain: AbstractDomain, varId: string): string {
  return `VarHandle<${domainLiteral(domain)}, ${stringLiteralType(varId)}>`;
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

/**
 * Emit one sibling module per source file that owns `useState` locals. Each module exports a
 * `VarHandle` value per field with the var id embedded in the handle type, so property files can
 * import from `./Component.vars` directly while the loader can still rewrite imported symbols to
 * `var("local:<Component>.<field>")` at check time.
 */
export function emitComponentVarModules(
  model: Model,
  appModelPath: string,
): ComponentVarModule[] {
  const byModule = localFieldsByModule(model, appModelPath);
  const modules: ComponentVarModule[] = [];

  for (const [path, entry] of [...byModule.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const sortedFields = [...entry.fields].sort(
      (left, right) =>
        left.field.localeCompare(right.field) ||
        left.componentId.localeCompare(right.componentId),
    );
    const fieldCounts = new Map<string, number>();
    for (const field of sortedFields) {
      fieldCounts.set(field.field, (fieldCounts.get(field.field) ?? 0) + 1);
    }
    const source = [
      'import { var as modalityVar, type VarHandle } from "modality-ts/core";',
      "",
      ...sortedFields.map((entry) => {
        const varId = `local:${entry.componentId}.${entry.field}`;
        return `export const ${collisionSafeExportName(entry, fieldCounts)}: ${handleType(
          entry.domain,
          varId,
        )} = modalityVar(${JSON.stringify(varId)}) as ${handleType(
          entry.domain,
          varId,
        )};`;
      }),
      "",
    ].join("\n");
    modules.push({
      ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
      fileName: parse(path).base,
      path,
      source,
    });
  }

  return modules;
}

/** Fallback directory (sibling of the app model) for synthetic local var modules. */
export function componentVarsDir(appModelPath: string): string {
  return join(dirname(appModelPath), "vars");
}
