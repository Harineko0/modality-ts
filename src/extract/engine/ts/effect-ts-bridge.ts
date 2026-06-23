import type * as ts from "typescript";
import type { EffectPlugin } from "../spi/index.js";
import type { ExtractableHandler, SetterBinding } from "./types.js";

/** Engine-local effect plugin facet for TypeScript AST recognition. */
export interface EngineEffectPlugin extends EffectPlugin {
  /**
   * Return any setter-varid taints produced by unextractable schedule calls
   * in node (used to generate havoc over-approximations).
   */
  getSetterTaints?(
    node: ts.Node,
    setters: Map<string, SetterBinding>,
  ): readonly { varId: string; node: ts.Node }[];

  /**
   * Return true when the JSX attribute handler schedules an effect that this
   * plugin can model — used by the engine to suppress "unextractable handler"
   * warnings.
   */
  handlerSchedulesModeledEffect?(
    attribute: ts.JsxAttribute,
    handlers: Map<string, ExtractableHandler>,
    setters: Map<string, SetterBinding>,
  ): boolean;
}

export function engineEffectPlugin(plugin: EffectPlugin): EngineEffectPlugin {
  return plugin as EngineEffectPlugin;
}

export function anyEffectPluginHandlesSchedule(
  plugins: readonly EffectPlugin[],
  attribute: ts.JsxAttribute,
  handlers: Map<string, ExtractableHandler>,
  setters: Map<string, SetterBinding>,
): boolean {
  for (const plugin of plugins) {
    if (
      engineEffectPlugin(plugin).handlerSchedulesModeledEffect?.(
        attribute,
        handlers,
        setters,
      )
    )
      return true;
  }
  return false;
}

export function collectSetterTaintsFromEffectPlugins(
  plugins: readonly EffectPlugin[],
  node: ts.Node,
  setters: Map<string, SetterBinding>,
): readonly { varId: string; node: ts.Node }[] {
  const taints: { varId: string; node: ts.Node }[] = [];
  for (const plugin of plugins) {
    const pts = engineEffectPlugin(plugin).getSetterTaints?.(node, setters);
    if (pts) taints.push(...pts);
  }
  return taints;
}
