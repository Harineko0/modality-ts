import { dirname, join } from "node:path";
import type { AbstractDomain, Model } from "modality-ts/core";
import { quoteProperty, stringLiteralType } from "./model.js";

interface LocalField {
  field: string;
  domain: AbstractDomain;
}

export interface ComponentVarModule {
  componentId: string;
  fileName: string;
  source: string;
}

function localFieldsByComponent(model: Model): Map<string, LocalField[]> {
  const byComponent = new Map<string, LocalField[]>();
  for (const decl of model.vars) {
    if (!decl.id.startsWith("local:")) continue;
    const rest = decl.id.slice("local:".length);
    const dot = rest.indexOf(".");
    if (dot < 0) continue;
    const componentId = rest.slice(0, dot);
    const field = rest.slice(dot + 1);
    const fields = byComponent.get(componentId) ?? [];
    fields.push({ field, domain: decl.domain });
    byComponent.set(componentId, fields);
  }
  return byComponent;
}

function varHandleType(domain: AbstractDomain, varId: string): string {
  return `VarHandle<${domainLiteral(domain)}, ${stringLiteralType(varId)}>`;
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
 * Emit one types-only module per component that owns `useState` locals. Each module exports a
 * `VarHandle` declaration per field with the var id embedded in the handle type, so the loader's
 * symbol rewriter can resolve `import { field } from "./.modality/vars/<Component>"` to
 * `varHandle("local:<Component>.<field>")` at check time (no runtime file is generated).
 */
export function emitComponentVarModules(model: Model): ComponentVarModule[] {
  const byComponent = localFieldsByComponent(model);
  const modules: ComponentVarModule[] = [];

  for (const [componentId, fields] of [...byComponent.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const sortedFields = [...fields].sort((left, right) =>
      left.field.localeCompare(right.field),
    );
    const source = [
      'import type { VarHandle } from "modality-ts/core";',
      "",
      ...sortedFields.map(
        (entry) =>
          `export declare const ${entry.field}: ${varHandleType(
            entry.domain,
            `local:${componentId}.${entry.field}`,
          )};`,
      ),
      "",
    ].join("\n");
    modules.push({
      componentId,
      fileName: `${componentId}.d.ts`,
      source,
    });
  }

  return modules;
}

/** Directory (sibling of the app model) that holds the generated per-component var modules. */
export function componentVarsDir(appModelPath: string): string {
  return join(dirname(appModelPath), "vars");
}
