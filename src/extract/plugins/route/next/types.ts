export type NextRouterKind = "app" | "pages";

export type NextSegmentKind =
  | "static"
  | "dynamic"
  | "catch-all"
  | "optional-catch-all"
  | "group"
  | "parallel-slot"
  | "intercept";

export interface NextParam {
  name: string;
  kind: "dynamic" | "catch-all" | "optional-catch-all";
}

export interface NextInterceptInfo {
  marker: "(.)" | "(..)" | "(...)" | "(..)(..)";
  targetPattern: string;
}

export type NextPagesDataExport =
  | "getStaticProps"
  | "getStaticPaths"
  | "getServerSideProps"
  | "getInitialProps";

export type NextRouteStatus = "not-found" | "forbidden" | "unauthorized";

export interface NextRouteTreeNode {
  id: string;
  router: NextRouterKind;
  pattern: string;
  segment: string;
  segmentKind: NextSegmentKind;
  parentId?: string;
  slot?: string;
  file?: string;
  layoutFile?: string;
  templateFile?: string;
  loadingFile?: string;
  errorFile?: string;
  defaultFile?: string;
  notFoundFile?: string;
  forbiddenFile?: string;
  unauthorizedFile?: string;
  routeFile?: string;
  apiFile?: string;
  groupNames: readonly string[];
  params: readonly NextParam[];
  intercept?: NextInterceptInfo;
  kind: "page" | "index" | "layout" | "resource";
  sharedLayout?: boolean;
  pageModuleId?: string;
  dataExports?: readonly NextPagesDataExport[];
  softNavigation?: boolean;
  status?: NextRouteStatus;
}

export function nextRouteTreeToMetadata(
  node: NextRouteTreeNode,
): Record<string, import("modality-ts/core").Value> {
  const record: Record<string, import("modality-ts/core").Value> = {
    id: node.id,
    router: node.router,
    pattern: node.pattern,
    segment: node.segment,
    segmentKind: node.segmentKind,
    groupNames: [...node.groupNames],
    params: node.params.map((param) => ({
      name: param.name,
      kind: param.kind,
    })),
    kind: node.kind,
  };
  if (node.parentId) record.parentId = node.parentId;
  if (node.slot) record.slot = node.slot;
  if (node.file) record.file = node.file;
  if (node.layoutFile) record.layoutFile = node.layoutFile;
  if (node.templateFile) record.templateFile = node.templateFile;
  if (node.loadingFile) record.loadingFile = node.loadingFile;
  if (node.errorFile) record.errorFile = node.errorFile;
  if (node.defaultFile) record.defaultFile = node.defaultFile;
  if (node.notFoundFile) record.notFoundFile = node.notFoundFile;
  if (node.forbiddenFile) record.forbiddenFile = node.forbiddenFile;
  if (node.unauthorizedFile) record.unauthorizedFile = node.unauthorizedFile;
  if (node.routeFile) record.routeFile = node.routeFile;
  if (node.apiFile) record.apiFile = node.apiFile;
  if (node.intercept) {
    record.intercept = {
      marker: node.intercept.marker,
      targetPattern: node.intercept.targetPattern,
    };
  }
  if (node.sharedLayout) record.sharedLayout = true;
  if (node.pageModuleId) record.pageModuleId = node.pageModuleId;
  if (node.dataExports?.length) record.dataExports = [...node.dataExports];
  if (node.softNavigation) record.softNavigation = true;
  if (node.status) record.status = node.status;
  return record;
}
