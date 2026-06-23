import { dirname, posix, resolve } from "node:path";
import type { Value } from "modality-ts/core";
import type {
  RouteDiscoveryCtx,
  RouteInventory,
  RouteKind,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import {
  type NextInterceptInfo,
  type NextPagesDataExport,
  type NextParam,
  type NextRouterKind,
  type NextRouteStatus,
  type NextRouteTreeNode,
  type NextSegmentKind,
  nextRouteTreeToMetadata,
} from "./types.js";

function isMetadataRecord(
  value: Value | undefined,
): value is Record<string, Value> {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function metadataString(
  record: Record<string, Value>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

const APP_ROOT = /^(?:src\/)?app(?:\/|$)/;
const PAGES_ROOT = /^(?:src\/)?pages(?:\/|$)/;

const INTERCEPT_MARKERS = [
  "(..)(..)",
  "(...)",
  "(..)",
  "(.)",
] as const satisfies readonly NextInterceptInfo["marker"][];

const PAGE_FILE = /^page\.(?:jsx?|tsx?|mdx)$/;
const ROUTE_FILE = /^route\.(?:js|ts)$/;
const LAYOUT_FILE = /^layout\.(?:jsx?|tsx?)$/;
const TEMPLATE_FILE = /^template\.(?:jsx?|tsx?)$/;
const LOADING_FILE = /^loading\.(?:jsx?|tsx?)$/;
const ERROR_FILE = /^error\.(?:jsx?|tsx?)$/;
const DEFAULT_FILE = /^default\.(?:jsx?|tsx?)$/;
const NOT_FOUND_FILE = /^not-found\.(?:jsx?|tsx?)$/;
const FORBIDDEN_FILE = /^forbidden\.(?:jsx?|tsx?)$/;
const UNAUTHORIZED_FILE = /^unauthorized\.(?:jsx?|tsx?)$/;
const METADATA_FILE =
  /^(?:icon|apple-icon|opengraph-image|twitter-image|sitemap|robots|manifest)\./;

const PAGES_PAGE_FILE = /\.(?:jsx?|tsx?)$/;
const PAGES_PRIVATE_FILE = /^_/;

const REDIRECT_LITERAL =
  /(?:permanentRedirect|redirect)\(\s*["']([^"']+)["']\s*\)/;
const NOT_FOUND_LITERAL = /\bnotFound\s*\(/;
const FORBIDDEN_LITERAL = /\bforbidden\s*\(/;
const UNAUTHORIZED_LITERAL = /\bunauthorized\s*\(/;

const DATA_EXPORT_PATTERNS: ReadonlyArray<{
  name: NextPagesDataExport;
  pattern: RegExp;
}> = [
  {
    name: "getStaticProps",
    pattern: /export\s+(?:async\s+)?function\s+getStaticProps\b/,
  },
  {
    name: "getStaticProps",
    pattern: /export\s+const\s+getStaticProps\b/,
  },
  {
    name: "getStaticPaths",
    pattern: /export\s+(?:async\s+)?function\s+getStaticPaths\b/,
  },
  {
    name: "getStaticPaths",
    pattern: /export\s+const\s+getStaticPaths\b/,
  },
  {
    name: "getServerSideProps",
    pattern: /export\s+(?:async\s+)?function\s+getServerSideProps\b/,
  },
  {
    name: "getServerSideProps",
    pattern: /export\s+const\s+getServerSideProps\b/,
  },
  {
    name: "getInitialProps",
    pattern: /export\s+(?:async\s+)?function\s+getInitialProps\b/,
  },
  {
    name: "getInitialProps",
    pattern: /export\s+const\s+getInitialProps\b/,
  },
];

export interface ParsedUrlSegment {
  readonly name: string;
  readonly segmentKind: NextSegmentKind;
  readonly param?: NextParam;
}

export interface ParsedPathSegment {
  readonly raw: string;
  readonly segmentKind: NextSegmentKind;
  readonly urlSegment?: ParsedUrlSegment;
  readonly groupName?: string;
  readonly slot?: string;
  readonly intercept?: NextInterceptInfo;
}

export function normalizeDiscoveredPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function relativizeDiscoveryPath(path: string, rootDir?: string): string {
  const normalized = normalizeDiscoveredPath(path);
  if (APP_ROOT.test(normalized) || PAGES_ROOT.test(normalized)) {
    return normalized;
  }
  if (rootDir) {
    const root = normalizeDiscoveredPath(resolve(rootDir));
    const prefix = `${root}/`;
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  }
  const appMatch = normalized.match(/((?:src\/)?app(?:\/.*)?)$/);
  if (appMatch?.[1]) return appMatch[1];
  const pagesMatch = normalized.match(/((?:src\/)?pages(?:\/.*)?)$/);
  if (pagesMatch?.[1]) return pagesMatch[1];
  return normalized;
}

export function parseAppPathSegment(segment: string): ParsedPathSegment {
  if (segment.startsWith("@")) {
    return {
      raw: segment,
      segmentKind: "parallel-slot",
      slot: segment.slice(1),
    };
  }

  const intercept = parseInterceptSegment(segment);
  if (intercept) return intercept;

  if (segment.startsWith("(") && segment.endsWith(")")) {
    return {
      raw: segment,
      segmentKind: "group",
      groupName: segment.slice(1, -1),
    };
  }

  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll?.[1]) {
    const name = optionalCatchAll[1];
    return {
      raw: segment,
      segmentKind: "optional-catch-all",
      urlSegment: {
        name,
        segmentKind: "optional-catch-all",
        param: { name, kind: "optional-catch-all" },
      },
    };
  }

  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) {
    const name = catchAll[1];
    return {
      raw: segment,
      segmentKind: "catch-all",
      urlSegment: {
        name,
        segmentKind: "catch-all",
        param: { name, kind: "catch-all" },
      },
    };
  }

  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic?.[1]) {
    const name = dynamic[1];
    return {
      raw: segment,
      segmentKind: "dynamic",
      urlSegment: {
        name,
        segmentKind: "dynamic",
        param: { name, kind: "dynamic" },
      },
    };
  }

  return {
    raw: segment,
    segmentKind: "static",
    urlSegment: { name: segment, segmentKind: "static" },
  };
}

export function parsePagesPathSegment(segment: string): ParsedPathSegment {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll?.[1]) {
    const name = optionalCatchAll[1];
    return {
      raw: segment,
      segmentKind: "optional-catch-all",
      urlSegment: {
        name,
        segmentKind: "optional-catch-all",
        param: { name, kind: "optional-catch-all" },
      },
    };
  }

  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) {
    const name = catchAll[1];
    return {
      raw: segment,
      segmentKind: "catch-all",
      urlSegment: {
        name,
        segmentKind: "catch-all",
        param: { name, kind: "catch-all" },
      },
    };
  }

  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic?.[1]) {
    const name = dynamic[1];
    return {
      raw: segment,
      segmentKind: "dynamic",
      urlSegment: {
        name,
        segmentKind: "dynamic",
        param: { name, kind: "dynamic" },
      },
    };
  }

  return {
    raw: segment,
    segmentKind: "static",
    urlSegment: { name: segment, segmentKind: "static" },
  };
}

export function urlSegmentsToPattern(
  segments: readonly ParsedUrlSegment[],
): string {
  if (segments.length === 0) return "/";
  const parts: string[] = [];
  for (const segment of segments) {
    switch (segment.segmentKind) {
      case "static":
        parts.push(segment.name);
        break;
      case "dynamic":
        parts.push(`:${segment.param?.name ?? segment.name}`);
        break;
      case "catch-all":
        parts.push("*");
        break;
      case "optional-catch-all":
        parts.push("*?");
        break;
      default:
        break;
    }
  }
  return `/${parts.join("/")}`;
}

function parseInterceptSegment(segment: string): ParsedPathSegment | undefined {
  for (const marker of INTERCEPT_MARKERS) {
    if (!segment.startsWith(marker)) continue;
    const targetSegment = segment.slice(marker.length);
    if (!targetSegment) continue;
    return {
      raw: segment,
      segmentKind: "intercept",
      intercept: {
        marker,
        targetPattern: urlSegmentsToPattern([
          { name: targetSegment, segmentKind: "static" },
        ]),
      },
      urlSegment: { name: targetSegment, segmentKind: "static" },
    };
  }
  return undefined;
}

function splitRouterPath(
  filePath: string,
  rootPattern: RegExp,
): { root: string; relativeDir: string; baseName: string } | undefined {
  const normalized = normalizeDiscoveredPath(filePath);
  const match = normalized.match(rootPattern);
  if (!match) return undefined;
  const root = match[0].endsWith("/")
    ? match[0].slice(0, -1)
    : match[0].replace(/\/$/, "");
  const remainder = normalized.slice(match[0].length);
  const slash = remainder.lastIndexOf("/");
  if (slash === -1) {
    return { root, relativeDir: "", baseName: remainder };
  }
  return {
    root,
    relativeDir: remainder.slice(0, slash),
    baseName: remainder.slice(slash + 1),
  };
}

interface DirectoryEntry {
  readonly relativeDir: string;
  readonly files: ReadonlyMap<string, string>;
}

function groupByDirectory(
  files: readonly { path: string }[],
  rootPattern: RegExp,
): Map<string, DirectoryEntry> {
  const directories = new Map<string, DirectoryEntry>();
  for (const file of files) {
    const split = splitRouterPath(file.path, rootPattern);
    if (!split) continue;
    const existing = directories.get(split.relativeDir);
    const nextFiles = new Map(existing?.files ?? []);
    nextFiles.set(split.baseName, file.path);
    directories.set(split.relativeDir, {
      relativeDir: split.relativeDir,
      files: nextFiles,
    });
  }
  return directories;
}

function parsePathSegments(
  relativeDir: string,
  parser: (segment: string) => ParsedPathSegment,
): ParsedPathSegment[] {
  if (!relativeDir) return [];
  return relativeDir.split("/").filter(Boolean).map(parser);
}

function buildPathContext(segments: readonly ParsedPathSegment[]): {
  urlSegments: ParsedUrlSegment[];
  groupNames: string[];
  slot: string;
  params: NextParam[];
  intercept?: NextInterceptInfo;
} {
  const groupNames: string[] = [];
  let slot = "children";
  for (const segment of segments) {
    if (segment.groupName) groupNames.push(segment.groupName);
    if (segment.slot) slot = segment.slot;
  }

  const interceptIndex = segments.findIndex((segment) => segment.intercept);
  const urlSegmentsSource =
    interceptIndex >= 0 ? segments.slice(interceptIndex) : segments;
  const { urlSegments, params, intercept } =
    collectUrlSegments(urlSegmentsSource);

  return { urlSegments, groupNames, slot, params, intercept };
}

function collectUrlSegments(segments: readonly ParsedPathSegment[]): {
  urlSegments: ParsedUrlSegment[];
  params: NextParam[];
  intercept?: NextInterceptInfo;
} {
  const urlSegments: ParsedUrlSegment[] = [];
  const params: NextParam[] = [];
  let intercept: NextInterceptInfo | undefined;

  for (const segment of segments) {
    if (segment.intercept) {
      intercept = segment.intercept;
      if (segment.urlSegment) {
        urlSegments.push(segment.urlSegment);
      }
      continue;
    }
    if (segment.urlSegment) {
      urlSegments.push(segment.urlSegment);
      if (segment.urlSegment.param) params.push(segment.urlSegment.param);
    }
  }

  return { urlSegments, params, intercept };
}

function makeNodeId(
  router: NextRouterKind,
  root: string,
  relativeDir: string,
  slot: string,
  kind: RouteKind,
): string {
  const slotSuffix = slot === "children" ? "" : `@${slot}`;
  const dirPart = relativeDir ? `/${relativeDir}` : "";
  return `${router}:${root}${dirPart}${slotSuffix}:${kind}`;
}

function routeKindForPage(pattern: string): RouteKind {
  return pattern === "/" ? "index" : "page";
}

function toRouteNode(tree: NextRouteTreeNode): RouteNode {
  const node: RouteNode = {
    pattern: tree.pattern,
    kind: tree.kind,
    metadata: {
      nextRouteTree: nextRouteTreeToMetadata(tree),
    },
  };
  const primaryFile =
    tree.file ??
    tree.routeFile ??
    tree.apiFile ??
    tree.layoutFile ??
    tree.templateFile;
  if (primaryFile) node.file = primaryFile;
  return node;
}

function discoverAppDirectories(
  files: readonly { path: string }[],
): NextRouteTreeNode[] {
  const directories = groupByDirectory(files, APP_ROOT);
  const nodes: NextRouteTreeNode[] = [];

  for (const [relativeDir, entry] of [...directories.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const split = splitRouterPath(
      entry.files.values().next().value ?? "",
      APP_ROOT,
    );
    if (!split) continue;
    const segments = parsePathSegments(relativeDir, parseAppPathSegment);
    const context = buildPathContext(segments);
    const pattern = urlSegmentsToPattern(context.urlSegments);
    const parentId =
      relativeDir.includes("/") || segments.length > 0
        ? makeNodeId(
            "app",
            split.root,
            dirname(relativeDir) === "."
              ? ""
              : dirname(relativeDir).replace(/^\.$/, ""),
            context.slot,
            "layout",
          )
        : undefined;

    const specialFiles = {
      layoutFile: findNamedFile(entry.files, LAYOUT_FILE),
      templateFile: findNamedFile(entry.files, TEMPLATE_FILE),
      loadingFile: findNamedFile(entry.files, LOADING_FILE),
      errorFile: findNamedFile(entry.files, ERROR_FILE),
      defaultFile: findNamedFile(entry.files, DEFAULT_FILE),
      notFoundFile: findNamedFile(entry.files, NOT_FOUND_FILE),
      forbiddenFile: findNamedFile(entry.files, FORBIDDEN_FILE),
      unauthorizedFile: findNamedFile(entry.files, UNAUTHORIZED_FILE),
    };

    const intercept =
      context.intercept !== undefined
        ? { ...context.intercept, targetPattern: pattern }
        : undefined;

    const pageFile = findNamedFile(entry.files, PAGE_FILE);
    if (pageFile) {
      const leafSegment = segments.at(-1);
      nodes.push({
        id: makeNodeId("app", split.root, relativeDir, context.slot, "page"),
        router: "app",
        pattern,
        segment: leafSegment?.raw ?? "page",
        segmentKind: leafSegment?.segmentKind ?? "static",
        parentId,
        slot: context.slot,
        file: pageFile,
        ...specialFiles,
        groupNames: context.groupNames,
        params: context.params,
        intercept,
        softNavigation: intercept !== undefined,
        kind: routeKindForPage(pattern),
      });
    }

    const routeFile = findNamedFile(entry.files, ROUTE_FILE);
    if (routeFile) {
      const leafSegment = segments.at(-1);
      nodes.push({
        id: makeNodeId(
          "app",
          split.root,
          relativeDir,
          context.slot,
          "resource",
        ),
        router: "app",
        pattern,
        segment: leafSegment?.raw ?? "route",
        segmentKind: leafSegment?.segmentKind ?? "static",
        parentId,
        slot: context.slot,
        routeFile,
        ...specialFiles,
        groupNames: context.groupNames,
        params: context.params,
        intercept,
        kind: "resource",
      });
    }

    if (specialFiles.layoutFile && !pageFile && !routeFile) {
      const leafSegment = segments.at(-1);
      nodes.push({
        id: makeNodeId("app", split.root, relativeDir, context.slot, "layout"),
        router: "app",
        pattern,
        segment: leafSegment?.raw ?? "layout",
        segmentKind: leafSegment?.segmentKind ?? "static",
        parentId,
        slot: context.slot,
        layoutFile: specialFiles.layoutFile,
        templateFile: specialFiles.templateFile,
        loadingFile: specialFiles.loadingFile,
        errorFile: specialFiles.errorFile,
        defaultFile: specialFiles.defaultFile,
        notFoundFile: specialFiles.notFoundFile,
        forbiddenFile: specialFiles.forbiddenFile,
        unauthorizedFile: specialFiles.unauthorizedFile,
        groupNames: context.groupNames,
        params: context.params,
        intercept,
        kind: "layout",
      });
    }
  }

  return nodes;
}

function findNamedFile(
  files: ReadonlyMap<string, string>,
  pattern: RegExp,
): string | undefined {
  for (const [name, path] of files.entries()) {
    if (pattern.test(name)) return path;
  }
  return undefined;
}

function discoverPagesDirectories(
  files: readonly { path: string }[],
): NextRouteTreeNode[] {
  const directories = groupByDirectory(files, PAGES_ROOT);
  const nodes: NextRouteTreeNode[] = [];

  for (const [relativeDir, entry] of [...directories.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const firstFile = entry.files.values().next().value;
    if (!firstFile) continue;
    const split = splitRouterPath(firstFile, PAGES_ROOT);
    if (!split) continue;

    const appFile = findPagesAppFile(entry.files);
    if (appFile) {
      nodes.push({
        id: `pages:${split.root}:_app`,
        router: "pages",
        pattern: "/",
        segment: "_app",
        segmentKind: "static",
        file: appFile,
        layoutFile: appFile,
        groupNames: [],
        params: [],
        kind: "layout",
        sharedLayout: true,
      });
    }

    for (const pageFile of findPagesRouteFiles(entry.files, relativeDir)) {
      const baseName = normalizeDiscoveredPath(pageFile).split("/").pop() ?? "";
      const fileStem = baseName.replace(/\.(?:jsx?|tsx?|ts)$/, "");
      const dirSegments = parsePathSegments(relativeDir, parsePagesPathSegment);
      const fileSegment =
        fileStem === "index" ? undefined : parsePagesPathSegment(fileStem);
      const segments = fileSegment
        ? [...dirSegments, fileSegment]
        : dirSegments;
      const context = buildPathContext(segments);
      const pattern = urlSegmentsToPattern(context.urlSegments);
      const isApi = relativeDir === "api" || relativeDir.startsWith("api/");
      const isIndex = fileStem === "index" && context.urlSegments.length === 0;
      const leafSegment = segments.at(-1);

      nodes.push({
        id: `pages:${split.root}:${relativeDir || "index"}:${fileStem}`,
        router: "pages",
        pattern,
        segment: isIndex ? "index" : (leafSegment?.raw ?? fileStem),
        segmentKind: leafSegment?.segmentKind ?? "static",
        file: pageFile,
        apiFile: isApi ? pageFile : undefined,
        groupNames: context.groupNames,
        params: context.params,
        kind: isApi ? "resource" : routeKindForPage(pattern),
        pageModuleId: pageFile,
      });
    }
  }

  return nodes;
}

function findPagesAppFile(
  files: ReadonlyMap<string, string>,
): string | undefined {
  for (const [name, path] of files.entries()) {
    if (name === "_app.tsx" || name === "_app.jsx") return path;
  }
  return undefined;
}

function isPagesRouteFile(name: string, relativeDir: string): boolean {
  if (relativeDir === "api" || relativeDir.startsWith("api/")) {
    return /\.ts$/.test(name);
  }
  return PAGES_PAGE_FILE.test(name);
}

function findPagesRouteFiles(
  files: ReadonlyMap<string, string>,
  relativeDir: string,
): string[] {
  const routes: string[] = [];
  for (const [name, path] of files.entries()) {
    if (name === "_document.tsx" || name === "_document.jsx") continue;
    if (name === "_error.tsx" || name === "_error.jsx") continue;
    if (name === "_app.tsx" || name === "_app.jsx") continue;
    if (PAGES_PRIVATE_FILE.test(name)) continue;
    if (METADATA_FILE.test(name)) continue;
    if (!isPagesRouteFile(name, relativeDir)) continue;
    routes.push(path);
  }
  return routes.sort();
}

function detectDataExports(source: string): NextPagesDataExport[] {
  const found = new Set<NextPagesDataExport>();
  for (const { name, pattern } of DATA_EXPORT_PATTERNS) {
    if (pattern.test(source)) found.add(name);
  }
  return [...found].sort();
}

function detectRouteStatus(source: string): NextRouteStatus | undefined {
  if (NOT_FOUND_LITERAL.test(source)) return "not-found";
  if (FORBIDDEN_LITERAL.test(source)) return "forbidden";
  if (UNAUTHORIZED_LITERAL.test(source)) return "unauthorized";
  return undefined;
}

function normalizeRedirectTarget(target: string): string {
  const withoutQuery = target.split(/[?#]/)[0] ?? target;
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

async function resolveFileText(
  ctx: RouteDiscoveryCtx,
  filePath: string,
): Promise<string> {
  const normalized = normalizeDiscoveredPath(filePath);
  const inline = ctx.files.find(
    (file) =>
      relativizeDiscoveryPath(file.path, ctx.rootDir) === normalized ||
      normalizeDiscoveredPath(file.path) === normalized,
  );
  if (inline) return inline.text;

  const candidates = new Set<string>([filePath, normalized]);
  if (ctx.rootDir) {
    candidates.add(resolve(ctx.rootDir, filePath));
    candidates.add(resolve(ctx.rootDir, normalized));
  }

  for (const candidate of candidates) {
    try {
      return await ctx.readFile(candidate);
    } catch {
      // try next candidate
    }
  }
  return "";
}

async function enrichRouteNodes(
  routes: RouteNode[],
  ctx: RouteDiscoveryCtx,
): Promise<void> {
  for (const route of routes) {
    const tree = route.metadata?.nextRouteTree;
    if (!isMetadataRecord(tree)) continue;

    const sourcePath =
      route.file ??
      metadataString(tree, "routeFile") ??
      metadataString(tree, "apiFile") ??
      metadataString(tree, "layoutFile");
    if (!sourcePath) continue;

    const source = await resolveFileText(ctx, sourcePath);
    if (!source) continue;

    const redirectMatch = REDIRECT_LITERAL.exec(source);
    REDIRECT_LITERAL.lastIndex = 0;
    if (redirectMatch?.[1]) {
      route.redirectTo = normalizeRedirectTarget(redirectMatch[1]);
    }

    const status = detectRouteStatus(source);
    const nextTree: Record<string, Value> = { ...tree };
    let changed = false;
    if (status) {
      nextTree.status = status;
      changed = true;
    }

    if (tree.router === "pages") {
      const dataExports = detectDataExports(source);
      if (dataExports.length > 0) {
        nextTree.dataExports = dataExports;
        changed = true;
      }
    }

    if (changed) {
      route.metadata = {
        ...route.metadata,
        nextRouteTree: nextTree,
      };
    }
  }
}

function compareRouteNodes(left: RouteNode, right: RouteNode): number {
  const pattern = left.pattern.localeCompare(right.pattern);
  if (pattern !== 0) return pattern;
  const leftTree = left.metadata?.nextRouteTree;
  const rightTree = right.metadata?.nextRouteTree;
  const leftSlot =
    isMetadataRecord(leftTree) && typeof leftTree.slot === "string"
      ? leftTree.slot
      : "";
  const rightSlot =
    isMetadataRecord(rightTree) && typeof rightTree.slot === "string"
      ? rightTree.slot
      : "";
  const slot = leftSlot.localeCompare(rightSlot);
  if (slot !== 0) return slot;
  return left.kind.localeCompare(right.kind);
}

export async function discoverRoutes(
  ctx: RouteDiscoveryCtx,
): Promise<RouteInventory> {
  const files = ctx.files.map((file) => ({
    ...file,
    path: relativizeDiscoveryPath(file.path, ctx.rootDir),
  }));
  const discoveryCtx = { ...ctx, files };
  const appFiles = files.filter((file) => APP_ROOT.test(file.path));
  const pagesFiles = files.filter((file) => PAGES_ROOT.test(file.path));

  const trees = [
    ...discoverAppDirectories(appFiles),
    ...discoverPagesDirectories(pagesFiles),
  ];
  const routes = trees.map(toRouteNode);
  await enrichRouteNodes(routes, discoveryCtx);
  routes.sort(compareRouteNodes);
  return { routes };
}

function normalizeComponentRouteName(component: string): string {
  return component.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function fileNameKeys(file: string): string[] {
  const base = posix.basename(file, posix.extname(file));
  const lastSeg = posix.basename(
    file.split("/").filter(Boolean).pop() ?? "",
    posix.extname(file),
  );
  return [
    normalizeComponentRouteName(base),
    normalizeComponentRouteName(lastSeg),
  ];
}

function suffixMatchLength(component: string, file: string): number {
  const normComp = normalizeComponentRouteName(component);
  const normFile = file.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  for (let len = Math.min(normComp.length, normFile.length); len > 0; len--) {
    const suffix = normFile.slice(-len);
    if (normComp.endsWith(suffix)) return len;
  }
  return 0;
}

export function routeForComponent(
  componentName: string,
  inventory: RouteInventory,
): string | undefined {
  const normalized = normalizeComponentRouteName(componentName);
  if (!normalized) return undefined;

  const preferred = inventory.routes.filter(
    (node) =>
      (node.kind === "page" || node.kind === "index") &&
      node.file !== undefined &&
      fileNameKeys(node.file).includes(normalized),
  );
  const candidates =
    preferred.length > 0
      ? preferred
      : inventory.routes.filter(
          (node) =>
            node.file !== undefined &&
            fileNameKeys(node.file).includes(normalized),
        );

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0]?.pattern;

  const ranked = [...candidates].sort(
    (left, right) =>
      suffixMatchLength(componentName, right.file ?? "") -
      suffixMatchLength(componentName, left.file ?? ""),
  );
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (
    best &&
    runnerUp &&
    suffixMatchLength(componentName, best.file ?? "") ===
      suffixMatchLength(componentName, runnerUp.file ?? "")
  ) {
    return undefined;
  }
  return best?.pattern;
}
