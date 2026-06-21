import * as ts from "typescript";
import type {
  DomainRefinementProvider,
  SemanticTypeContext,
  SourceDecl,
} from "modality-ts/extract/engine/spi";
import { modelSlackCaveat } from "../../engine/ts/caveats.js";
import { semanticSourceFileFor } from "../../engine/ts/semantic-source-file.js";
import { literalValue } from "../../engine/ts/ast.js";
import { isCreateApiCall, resolveReduxImports } from "./imports.js";
import { propertyNameFromMember } from "./domains.js";
import { mutationVarId, queryVarId, safeKeyId } from "./ids.js";
import {
  mutationMetadataToRecord,
  queryMetadataToRecord,
  type ReduxMutationMetadata,
  type ReduxQueryMetadata,
} from "./types.js";
import type { ReduxDiscoveryWarning } from "./store.js";
import { anchor } from "./store.js";

export interface RtkQueryDiscovery {
  decls: SourceDecl[];
  warnings: ReduxDiscoveryWarning[];
  apiNames: Set<string>;
}

export function discoverRtkQueryApis(
  sourceText: string,
  fileName = "api.ts",
  types?: SemanticTypeContext,
  _domainRefinements?: readonly DomainRefinementProvider[],
): RtkQueryDiscovery {
  const source = semanticSourceFileFor(sourceText, fileName, types, ts.ScriptKind.TSX);
  const imports = resolveReduxImports(source, types);
  if (imports.apiCreators.size === 0) {
    return { decls: [], warnings: [], apiNames: new Set() };
  }
  const decls: SourceDecl[] = [];
  const warnings: ReduxDiscoveryWarning[] = [];
  const apiNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateApiCall(node.initializer, imports)
    ) {
      const apiName = node.name.text;
      apiNames.add(apiName);
      const config = node.initializer.arguments[0];
      if (!config || !ts.isObjectLiteralExpression(config)) return;
      let reducerPath = apiName;
      const endpoints = new Map<string, "query" | "mutation">();
      for (const prop of config.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = propertyNameFromMember(prop.name);
        if (!name) continue;
        if (name === "reducerPath" && ts.isStringLiteral(prop.initializer)) {
          reducerPath = prop.initializer.text;
        }
        if (name === "endpoints") {
        if (ts.isArrowFunction(prop.initializer)) {
          const body = prop.initializer.body;
          if (ts.isCallExpression(body) && ts.isIdentifier(body.expression)) {
            parseEndpointsBuilder(body, endpoints);
          } else if (ts.isObjectLiteralExpression(body)) {
            parseEndpointsObject(body, endpoints);
          } else if (
            ts.isParenthesizedExpression(body) &&
            ts.isObjectLiteralExpression(body.expression)
          ) {
            parseEndpointsObject(body.expression, endpoints);
          }
        }
      }
      }
      for (const [endpoint, kind] of endpoints) {
        const keyId = safeKeyId(endpoint);
        const origin = anchor(source, fileName, node);
        if (kind === "query") {
          const metadata: ReduxQueryMetadata = {
            apiName,
            endpoint,
            keyId,
            reducerPath,
            op: "query",
            payloadDomain: { kind: "tokens", count: 1 },
          };
          decls.push({
            id: `redux-query:${apiName}:${endpoint}`,
            kind: "redux-query/useQuery",
            origin,
            metadata: queryMetadataToRecord(metadata),
          });
        } else {
          const siteId = `${fileName}:${origin.line ?? 0}:${origin.column ?? 0}`;
          const metadata: ReduxMutationMetadata = {
            apiName,
            endpoint,
            siteId,
            reducerPath,
            payloadDomain: { kind: "tokens", count: 1 },
          };
          decls.push({
            id: `redux-mutation:${apiName}:${endpoint}`,
            kind: "redux-query/useMutation",
            origin,
            metadata: mutationMetadataToRecord(metadata),
          });
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const hookName = node.expression.text;
      if (hookName.startsWith("use") && hookName.endsWith("Query")) {
        const endpoint = endpointFromHookName(hookName);
        const keyArg = node.arguments[0];
        const keyId = queryKeyIdFromArg(keyArg);
        if (!keyId) {
          warnings.push({
            message: "Redux RTK Query dynamic key not modeled",
            source: anchor(source, fileName, node),
            caveat: modelSlackCaveat(
              `redux-query:${hookName}:dynamic-key`,
              "Redux RTK Query dynamic key not modeled",
              anchor(source, fileName, node),
            ),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { decls, warnings, apiNames };
}

function parseEndpointsBuilder(
  call: ts.CallExpression,
  endpoints: Map<string, "query" | "mutation">,
): void {
  let current: ts.CallExpression | undefined = call;
  while (current) {
    if (
      ts.isPropertyAccessExpression(current.expression) &&
      (current.expression.name.text === "query" ||
        current.expression.name.text === "mutation")
    ) {
      const endpointName = current.arguments[0];
      if (ts.isStringLiteral(endpointName)) {
        endpoints.set(
          endpointName.text,
          current.expression.name.text === "query" ? "query" : "mutation",
        );
      } else if (ts.isIdentifier(endpointName)) {
        endpoints.set(
          endpointName.text,
          current.expression.name.text === "query" ? "query" : "mutation",
        );
      }
    }
    if (ts.isCallExpression(current.expression)) {
      current = current.expression;
      continue;
    }
    break;
  }
}

function parseEndpointsObject(
  object: ts.ObjectLiteralExpression,
  endpoints: Map<string, "query" | "mutation">,
): void {
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const endpointName = propertyNameFromMember(prop.name);
    if (!endpointName) continue;
    if (
      ts.isCallExpression(prop.initializer) &&
      ts.isPropertyAccessExpression(prop.initializer.expression) &&
      (prop.initializer.expression.name.text === "query" ||
        prop.initializer.expression.name.text === "mutation")
    ) {
      endpoints.set(
        endpointName,
        prop.initializer.expression.name.text === "query"
          ? "query"
          : "mutation",
      );
    }
  }
}

function endpointFromHookName(hookName: string): string {
  const base = hookName.slice(3, -5);
  if (!base) return hookName;
  return base.charAt(0).toLowerCase() + base.slice(1);
}

function queryKeyIdFromArg(arg: ts.Expression | undefined): string | undefined {
  if (!arg) return "default";
  const lit = literalValue(arg);
  if (typeof lit === "string") return safeKeyId(lit);
  if (ts.isNumericLiteral(arg)) return safeKeyId(arg.text);
  return undefined;
}

export function queryTemplateVarIds(
  apiName: string,
  endpoint: string,
  keyId: string,
): string[] {
  return ["status", "data", "error", "isFetching", "isSuccess", "isError"].map(
    (field) => queryVarId(apiName, endpoint, keyId, field),
  );
}

export function mutationTemplateVarIds(
  apiName: string,
  endpoint: string,
  siteId: string,
): string[] {
  return ["status", "data", "error", "variables"].map((field) =>
    mutationVarId(apiName, endpoint, siteId, field),
  );
}
