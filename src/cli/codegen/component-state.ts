import { dirname, join, parse } from "node:path";
import type {
  AbstractDomain,
  Model,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import { quoteProperty, stringLiteralType } from "./model.js";
import {
  buildTransitionTree,
  componentExportName,
  type TransitionComponentGroup,
} from "./transition-handles.js";

interface LocalField {
  componentId: string;
  field: string;
  domain: AbstractDomain;
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
): Map<
  string,
  { sourcePath?: string; components: TransitionComponentGroup[] }
> {
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
    { sourcePath?: string; components: TransitionComponentGroup[] }
  >();
  for (const [path, entry] of grouped) {
    byModule.set(path, {
      ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
      components: buildTransitionTree(entry.transitions),
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

interface TransitionPathNode {
  transitionId?: string;
  children?: Map<string, TransitionPathNode>;
}

function ensureBranchChildren(
  node: TransitionPathNode,
): Map<string, TransitionPathNode> {
  if (node.transitionId) {
    if (!node.children) {
      node.children = new Map();
    }
    if (!node.children.has("_")) {
      node.children.set("_", { transitionId: node.transitionId });
    }
    delete node.transitionId;
  }
  if (!node.children) {
    node.children = new Map();
  }
  return node.children;
}

function insertTransitionPath(
  root: Map<string, TransitionPathNode>,
  path: readonly string[],
  transitionId: string,
): void {
  let current = root;
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    const isLeaf = index === path.length - 1;
    let node = current.get(key);
    if (!node) {
      node = {};
      current.set(key, node);
    }
    if (isLeaf) {
      if (node.children && node.children.size > 0) {
        const children = ensureBranchChildren(node);
        const existing = children.get("_");
        if (existing?.transitionId && existing.transitionId !== transitionId) {
          throw new Error(`Duplicate transition path "${path.join(".")}"`);
        }
        children.set("_", { transitionId });
        return;
      }
      if (node.transitionId && node.transitionId !== transitionId) {
        throw new Error(`Duplicate transition path "${path.join(".")}"`);
      }
      node.transitionId = transitionId;
      return;
    }
    current = ensureBranchChildren(node);
  }
}

function emitTransitionPathTree(
  tree: ReadonlyMap<string, TransitionPathNode>,
  indent: string,
  lines: string[],
): void {
  for (const [key, node] of [...tree.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    if (node.children && node.children.size > 0) {
      lines.push(`${indent}${quoteProperty(key)}: {`);
      emitTransitionPathTree(node.children, `${indent}  `, lines);
      lines.push(`${indent}},`);
      continue;
    }
    if (!node.transitionId) continue;
    const type = transitionHandleType(node.transitionId);
    lines.push(
      `${indent}${quoteProperty(key)}: ${JSON.stringify(node.transitionId)} as ${type},`,
    );
  }
}

function emitTransitionsSection(
  components: readonly TransitionComponentGroup[],
  stateExportNames: ReadonlySet<string>,
): string[] {
  const lines: string[] = ["// transitions"];
  for (const group of components) {
    const exportName = componentExportName(group.component);
    if (stateExportNames.has(exportName)) {
      throw new Error(
        `Transition handle export "${exportName}" collides with a state export in the same module`,
      );
    }
    lines.push(`export const ${exportName} = {`);
    for (const eventGroup of group.events) {
      const tree = new Map<string, TransitionPathNode>();
      for (const leaf of eventGroup.leaves) {
        insertTransitionPath(tree, leaf.path, leaf.transitionId);
      }
      lines.push(`  ${quoteProperty(eventGroup.event)}: {`);
      emitTransitionPathTree(tree, "    ", lines);
      lines.push("  },");
    }
    lines.push("};");
  }
  return lines;
}

function emitModuleSource(
  fields: readonly LocalField[],
  components: readonly TransitionComponentGroup[],
): string {
  const hasState = fields.length > 0;
  const hasTransitions = components.length > 0;
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

  const stateExportNames = new Set<string>();

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
      const exportName = collisionSafeExportName(entry, fieldCounts);
      stateExportNames.add(exportName);
      const varId = `local:${entry.componentId}.${entry.field}`;
      lines.push(
        `export const ${exportName}: ${handleType(
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
    lines.push(...emitTransitionsSection(components, stateExportNames));
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
    const components = transitionEntry?.components ?? [];
    if (fields.length === 0 && components.length === 0) continue;
    modules.push({
      ...((fieldEntry?.sourcePath ?? transitionEntry?.sourcePath)
        ? {
            sourcePath: fieldEntry?.sourcePath ?? transitionEntry?.sourcePath,
          }
        : {}),
      fileName: parse(path).base,
      path,
      source: emitModuleSource(fields, components),
    });
  }

  return modules;
}

/** Fallback directory (sibling of the app model) for synthetic local modal modules. */
export function componentModalsDir(appModelPath: string): string {
  return join(dirname(appModelPath), "modals");
}
