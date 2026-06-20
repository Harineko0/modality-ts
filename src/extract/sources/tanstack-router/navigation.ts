import type { NavIntent } from "modality-ts/extract/engine/spi";
import { normalizeRouteTarget } from "../../engine/ts/routes.js";
import { tanstackPathToPattern } from "./discover.js";

export type TanstackNavigationWarning = {
  kind: "model-slack" | "security-caveat";
  message: string;
};

export type TanstackNavClassification =
  | NavIntent
  | { kind: "search-only"; origin?: string }
  | "unsupported";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReplaceOptions(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "replace" in value &&
    (value as { replace: unknown }).replace === true
  );
}

function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/");
}

function isJavascriptUrl(url: string): boolean {
  return /^javascript:/i.test(url.trim());
}

function overApproximateRouteTarget(
  routePatterns: readonly string[],
): string | undefined {
  const uiRoutes = routePatterns.filter((pattern) => pattern !== "/api");
  return uiRoutes[0];
}

function tanstackToPattern(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] || "/";
  return tanstackPathToPattern(withoutQuery);
}

function resolveRelativeTo(
  to: string,
  from: string,
  routePatterns: readonly string[],
): string {
  if (to.startsWith("/")) return tanstackToPattern(to);
  const base = from.endsWith("/") ? from.slice(0, -1) : from;
  const parent = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const joined =
    parent.length > 0
      ? `${parent}/${to}`.replace(/\/+/g, "/")
      : `/${to}`.replace(/\/+/g, "/");
  return normalizeRouteTarget(tanstackToPattern(joined), routePatterns);
}

export function resolveTanstackToTarget(
  options: Record<string, unknown>,
  routePatterns: readonly string[] = [],
  warnings: TanstackNavigationWarning[] = [],
  componentOrigin?: string,
): string | undefined {
  const to = options.to;
  const from =
    typeof options.from === "string"
      ? tanstackToPattern(options.from)
      : undefined;
  const origin = from ?? componentOrigin;

  if (to === undefined) {
    if (options.search !== undefined) {
      warnings.push({
        kind: "model-slack",
        message:
          "Search-only TanStack navigation keeps the current route; search state may be under-approximated",
      });
      if (origin) return normalizeRouteTarget(origin, routePatterns);
      return overApproximateRouteTarget(routePatterns);
    }
    return undefined;
  }

  if (typeof to !== "string") {
    warnings.push({
      kind: "model-slack",
      message:
        "Dynamic TanStack navigation target over-approximates to known routes",
    });
    return overApproximateRouteTarget(routePatterns);
  }

  if (isExternalUrl(to)) return undefined;
  if (isJavascriptUrl(to)) {
    warnings.push({
      kind: "security-caveat",
      message: `Unsanitized javascript: navigation target "${to}" is a security risk`,
    });
    return undefined;
  }

  const pattern = to.startsWith("/")
    ? tanstackToPattern(to)
    : origin
      ? resolveRelativeTo(to, origin, routePatterns)
      : (() => {
          warnings.push({
            kind: "model-slack",
            message:
              "Relative TanStack navigation without `from` over-approximates to known route patterns",
          });
          return overApproximateRouteTarget(routePatterns);
        })();

  if (!pattern) return undefined;
  return normalizeRouteTarget(pattern, routePatterns);
}

function navigationOptionsFromArgs(
  args: readonly unknown[],
): Record<string, unknown> | undefined {
  if (args.length === 0) return undefined;
  const first = args[0];
  if (typeof first === "string") return undefined;
  return isRecord(first) ? first : undefined;
}

function isTanstackNavigateCallee(callee: string): boolean {
  return callee === "navigate" || callee.endsWith(".navigate");
}

function isTanstackBackCallee(callee: string): boolean {
  return (
    callee.endsWith(".history.back") ||
    callee.endsWith(".back") ||
    callee === "history.back"
  );
}

export function classifyTanstackNavigationCall(
  callee: string,
  args: readonly unknown[],
  routePatterns: readonly string[] = [],
  componentOrigin?: string,
): {
  classification: TanstackNavClassification;
  warnings: TanstackNavigationWarning[];
} {
  const warnings: TanstackNavigationWarning[] = [];

  if (isTanstackBackCallee(callee) && args.length === 0) {
    return { classification: { mode: "back" }, warnings };
  }

  if (!isTanstackNavigateCallee(callee)) {
    return { classification: "unsupported", warnings };
  }

  const options = navigationOptionsFromArgs(args);
  if (!options) return { classification: "unsupported", warnings };

  const replace = isReplaceOptions(options);
  const target = resolveTanstackToTarget(
    options,
    routePatterns,
    warnings,
    componentOrigin,
  );

  if (options.to === undefined && options.search !== undefined) {
    if (!target) return { classification: "unsupported", warnings };
    return {
      classification: { kind: "search-only", origin: target },
      warnings,
    };
  }

  if (!target) return { classification: "unsupported", warnings };

  return {
    classification: {
      mode: replace ? "replace" : "push",
      to: target,
    },
    warnings,
  };
}

export function classifyTanstackNavigationJsx(
  tag: string,
  attrs: ReadonlyMap<string, unknown>,
  routePatterns: readonly string[] = [],
  componentOrigin?: string,
): {
  classification: TanstackNavClassification;
  warnings: TanstackNavigationWarning[];
} {
  const warnings: TanstackNavigationWarning[] = [];

  if (tag !== "Link" && tag !== "Navigate") {
    return { classification: "unsupported", warnings };
  }

  const options: Record<string, unknown> = {};
  const to = attrs.get("to");
  if (to !== undefined) options.to = to;
  if (attrs.has("from")) options.from = attrs.get("from");
  if (attrs.has("params")) options.params = attrs.get("params");
  if (attrs.has("search")) options.search = attrs.get("search");
  if (attrs.has("hash")) options.hash = attrs.get("hash");
  if (attrs.has("state")) options.state = attrs.get("state");
  if (attrs.has("replace")) options.replace = true;

  const replace =
    tag === "Navigate" ? attrs.has("replace") : attrs.has("replace");
  const target = resolveTanstackToTarget(
    options,
    routePatterns,
    warnings,
    componentOrigin,
  );

  if (options.to === undefined && options.search !== undefined) {
    if (!target) return { classification: "unsupported", warnings };
    return {
      classification: { kind: "search-only", origin: target },
      warnings,
    };
  }

  if (!target) return { classification: "unsupported", warnings };

  return {
    classification: {
      mode: replace ? "replace" : "push",
      to: target,
    },
    warnings,
  };
}

function navIntentFromClassification(
  classification: TanstackNavClassification,
): NavIntent | "unsupported" {
  if (classification === "unsupported") return "unsupported";
  if ("kind" in classification) {
    if (classification.kind === "search-only" && classification.origin) {
      return { mode: "push", to: classification.origin };
    }
    return "unsupported";
  }
  return classification;
}

export function classifyNavigationCall(
  callee: string,
  args: readonly unknown[],
): NavIntent | "unsupported" {
  return navIntentFromClassification(
    classifyTanstackNavigationCall(callee, args).classification,
  );
}

export function classifyNavigationJsx(
  tag: string,
  attrs: ReadonlyMap<string, unknown>,
): NavIntent | "unsupported" {
  return navIntentFromClassification(
    classifyTanstackNavigationJsx(tag, attrs).classification,
  );
}
