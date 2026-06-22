import {
  normalizePackageNames,
  validatePluginId,
  validatePluginVersion,
} from "./validate.js";

export type PluginKind =
  | "state-source"
  | "framework"
  | "route"
  | "type"
  | "effect"
  | "module-roles"
  | "effect-api"
  | "route-execution"
  | "cache-storage"
  | "observation";

export interface PluginBase {
  readonly id: string;
  readonly kind: PluginKind;
  readonly version?: string;
  readonly packageNames: readonly string[];
}

export interface CreatePluginConfig<
  TKind extends PluginKind,
  _TFields extends Record<string, unknown>,
> {
  readonly id: string;
  readonly kind: TKind;
  readonly version?: string;
  readonly packageNames: readonly string[];
  readonly [key: string]: unknown;
}

export function createPlugin<
  TKind extends PluginKind,
  TFields extends Record<string, unknown>,
>(
  config: CreatePluginConfig<TKind, TFields> & TFields,
): PluginBase & TFields & { readonly kind: TKind } {
  validatePluginId(config.id, config.kind);
  validatePluginVersion(config.version, config.id, config.kind);
  const packageNames = normalizePackageNames(config.packageNames, config.id);
  const { id, kind, version } = config;
  return {
    ...(config as TFields),
    id,
    kind,
    ...(version !== undefined ? { version } : {}),
    packageNames,
  } as PluginBase & TFields & { readonly kind: TKind };
}

function rejectUnknownKeys(
  config: Record<string, unknown>,
  allowed: readonly string[],
  pluginId: string,
  category: string,
): void {
  for (const key of Object.keys(config)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `Invalid ${category} plugin ${pluginId}: unexpected field ${key}`,
      );
    }
  }
}

export { rejectUnknownKeys };
