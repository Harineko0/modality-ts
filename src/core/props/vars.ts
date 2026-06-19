import { variable } from "./operand.js";

/**
 * Built-in handles for the stable, framework-synthesized system variables.
 *
 * These ids are fixed regardless of the app (unlike `local:*` component state, which is
 * generated beside their source files as `<source>.vars.ts`. Import them directly:
 *
 * ```ts
 * import { pending, route } from "modality-ts/vars";
 * always("noDoubleSubmit", neq(pending.at("0", "opId"), "api.placeOrder"));
 * ```
 *
 * Parameterized system ids (`sys:timer:*`, `sys:suspense:*`, …) and resource ids (`swr:*`)
 * are project-specific — reference those with `variable("...")`.
 */

/** The pending-operation queue (`sys:pending`). Index with `pending.at("0", "opId")`. */
export const pending = variable("sys:pending");

/** The current route / location (`sys:route`). */
export const route = variable("sys:route");

/** The navigation history stack (`sys:history`). */
export const history = variable("sys:history");
