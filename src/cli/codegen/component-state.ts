import { dirname, join, parse } from "node:path";
import type {
  AbstractDomain,
  Model,
  SourceAnchor,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import { varHandleNaming } from "./handle-naming.js";
import { quoteProperty, stringLiteralType } from "./model.js";
import {
  buildTransitionTree,
  componentExportName,
  type TransitionComponentGroup,
} from "./transition-handles.js";

export { varHandleNaming } from "./handle-naming.js";

interface VarHandle {
  varId: string;
  exportName: string;
  path: string[];
  domain: AbstractDomain;
}

export interface ComponentModalModule {
  sourcePath?: string;
  fileName: string;
  path: string;
  source: string;
}

function modulePathForSource(sourcePath: string): string {
  const parsed = parse(sourcePath);
  return join(parsed.dir, `${parsed.name}.modals.ts`);
}

function varHandlesByModule(
  model: Model,
): Map<string, { sourcePath?: string; handles: VarHandle[] }> {
  const byModule = new Map<
    string,
    { sourcePath?: string; handles: VarHandle[] }
  >();
  for (const decl of model.vars) {
    const origin = sourceAnchorForVarDecl(model, decl);
    if (!origin) continue;
    const naming = varHandleNaming(decl.id);
    if (!naming) continue;
    const sourcePath = origin.file;
    const path = modulePathForSource(sourcePath);
    const entry = byModule.get(path) ?? {
      sourcePath,
      handles: [],
    };
    entry.handles.push({
      varId: decl.id,
      exportName: naming.exportName,
      path: naming.path,
      domain: decl.domain,
    });
    byModule.set(path, entry);
  }
  return byModule;
}

function sourceAnchorForVarDecl(
  model: Model,
  decl: StateVarDecl,
): SourceAnchor | undefined {
  if (typeof decl.origin === "object") return decl.origin;
  const anchored = model.metadata?.varAnchors?.[decl.id];
  if (anchored) return anchored;
  return sourceAnchorFromTemplateTransitions(model, decl.id);
}

function sourceAnchorFromTemplateTransitions(
  model: Model,
  varId: string,
): SourceAnchor | undefined {
  const prefix = transitionPrefixForTemplateVar(varId);
  if (!prefix) return undefined;
  for (const transition of model.transitions) {
    if (!transition.id.startsWith(prefix)) continue;
    const source = transition.source[0];
    if (source) return source;
  }
  return undefined;
}

function transitionPrefixForTemplateVar(varId: string): string | undefined {
  const colon = varId.indexOf(":");
  if (colon < 0) return undefined;
  const kind = varId.slice(0, colon);
  const rest = varId.slice(colon + 1);
  const segments = rest.split(":").filter((segment) => segment.length > 0);
  if (segments.length < 2) return undefined;
  const field = segments.at(-1);
  if (!field || !templateCacheFields.has(field)) return undefined;
  const key = segments.slice(0, -1).join(":");
  if (!key) return undefined;
  return `${kind}:${key}:`;
}

const templateCacheFields = new Set([
  "data",
  "isValidating",
  "error",
  "status",
  "isLoading",
  "isFetching",
]);

function transitionsByModule(
  model: Model,
  stateExportNamesByModule: ReadonlyMap<string, ReadonlySet<string>>,
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
      components: buildTransitionTree(
        entry.transitions,
        stateExportNamesByModule.get(path),
      ),
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

function isDirectTransitionLeaf(
  eventGroup: TransitionComponentGroup["events"][number],
): { transitionId: string } | undefined {
  if (eventGroup.leaves.length !== 1) return undefined;
  const leaf = eventGroup.leaves[0];
  if (leaf?.path.length !== 0) return undefined;
  return { transitionId: leaf.transitionId };
}

function emitVarPathTree(
  tree: ReadonlyMap<string, TransitionPathNode>,
  handles: readonly VarHandle[],
  indent: string,
  lines: string[],
): void {
  const handlesById = new Map(handles.map((handle) => [handle.varId, handle]));
  for (const [key, node] of [...tree.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    if (node.children && node.children.size > 0) {
      lines.push(`${indent}${quoteProperty(key)}: {`);
      emitVarPathTree(node.children, handles, `${indent}  `, lines);
      lines.push(`${indent}},`);
      continue;
    }
    if (!node.transitionId) continue;
    const handle = handlesById.get(node.transitionId);
    if (!handle) continue;
    lines.push(
      `${indent}${quoteProperty(key)}: variable(${JSON.stringify(handle.varId)}) as ${handleType(
        handle.domain,
        handle.varId,
      )},`,
    );
  }
}

function emitModuleSource(
  handles: readonly VarHandle[],
  components: readonly TransitionComponentGroup[],
): string {
  const hasState = handles.length > 0;
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

  const handlesByExport = new Map<string, VarHandle[]>();
  for (const handle of handles) {
    const entries = handlesByExport.get(handle.exportName) ?? [];
    entries.push(handle);
    handlesByExport.set(handle.exportName, entries);
  }
  const transitionsByExport = new Map<string, TransitionComponentGroup>();
  for (const component of components) {
    transitionsByExport.set(
      componentExportName(component.component),
      component,
    );
  }
  const exportNames = [
    ...new Set([...handlesByExport.keys(), ...transitionsByExport.keys()]),
  ].sort((left, right) => left.localeCompare(right));

  for (const [index, exportName] of exportNames.entries()) {
    if (index > 0) lines.push("");
    const exportHandles = [...(handlesByExport.get(exportName) ?? [])].sort(
      (left, right) =>
        left.path.join(".").localeCompare(right.path.join(".")) ||
        left.varId.localeCompare(right.varId),
    );
    const componentTransitions = transitionsByExport.get(exportName);

    if (
      exportHandles.length === 1 &&
      exportHandles[0]!.path.length === 0 &&
      !componentTransitions
    ) {
      const handle = exportHandles[0]!;
      lines.push(
        `export const ${exportName}: ${handleType(handle.domain, handle.varId)} = variable(${JSON.stringify(handle.varId)});`,
      );
      continue;
    }

    lines.push(`export const ${exportName} = {`);
    if (exportHandles.length > 0) {
      lines.push("  // state");
      const tree = new Map<string, TransitionPathNode>();
      for (const handle of exportHandles) {
        insertTransitionPath(
          tree,
          handle.path.length > 0 ? handle.path : ["_"],
          handle.varId,
        );
      }
      emitVarPathTree(tree, exportHandles, "  ", lines);
    }

    if (componentTransitions) {
      if (exportHandles.length > 0) {
        lines.push("");
      }
      lines.push("  // transitions");
      for (const eventGroup of componentTransitions.events) {
        const directLeaf = isDirectTransitionLeaf(eventGroup);
        if (directLeaf) {
          const type = transitionHandleType(directLeaf.transitionId);
          lines.push(
            `  ${quoteProperty(eventGroup.event)}: ${JSON.stringify(directLeaf.transitionId)} as ${type},`,
          );
          continue;
        }
        const tree = new Map<string, TransitionPathNode>();
        for (const leaf of eventGroup.leaves) {
          insertTransitionPath(tree, leaf.path, leaf.transitionId);
        }
        lines.push(`  ${quoteProperty(eventGroup.event)}: {`);
        emitTransitionPathTree(tree, "    ", lines);
        lines.push("  },");
      }
    }
    lines.push("};");
  }

  if (!hasState && !hasTransitions) {
    lines.push("");
  } else {
    if (lines.at(-1) !== "") {
      lines.push("");
    }
  }
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
  void appModelPath;
  const handlesByModule = varHandlesByModule(model);
  const stateExportNamesByModule = new Map<string, Set<string>>();
  for (const [path, entry] of handlesByModule) {
    stateExportNamesByModule.set(
      path,
      new Set(entry.handles.map((handle) => handle.exportName)),
    );
  }
  const transitionsByPath = transitionsByModule(
    model,
    stateExportNamesByModule,
  );
  const paths = [
    ...new Set([...handlesByModule.keys(), ...transitionsByPath.keys()]),
  ].sort((left, right) => left.localeCompare(right));

  const modules: ComponentModalModule[] = [];
  for (const path of paths) {
    const fieldEntry = handlesByModule.get(path);
    const transitionEntry = transitionsByPath.get(path);
    const handles = fieldEntry?.handles ?? [];
    const components = transitionEntry?.components ?? [];
    if (handles.length === 0 && components.length === 0) continue;
    modules.push({
      ...((fieldEntry?.sourcePath ?? transitionEntry?.sourcePath)
        ? {
            sourcePath: fieldEntry?.sourcePath ?? transitionEntry?.sourcePath,
          }
        : {}),
      fileName: parse(path).base,
      path,
      source: emitModuleSource(handles, components),
    });
  }

  return modules;
}

/** Fallback directory (sibling of the app model) for synthetic local modal modules. */
export function componentModalsDir(appModelPath: string): string {
  return join(dirname(appModelPath), "modals");
}
