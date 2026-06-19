import { varHandle } from "./operand.js";

/**
 * Built-in handles for the stable, framework-synthesized system variables.
 *
 * These ids are fixed regardless of the app (unlike `local:*` component state, which is
 * generated per project into `.modality/vars/<Component>.d.ts`). Import them directly:
 *
 * ```ts
 * import { pending, route } from "modality-ts/vars";
 * always("noDoubleSubmit", neq(pending.at("0", "opId"), "api.placeOrder"));
 * ```
 *
 * Parameterized system ids (`sys:timer:*`, `sys:suspense:*`, …) and resource ids (`swr:*`)
 * are project-specific — reference those with `varHandle("...")`.
 */

/** The pending-operation queue (`sys:pending`). Index with `pending.at("0", "opId")`. */
export const pending = varHandle("sys:pending");

/** The current route / location (`sys:route`). */
export const route = varHandle("sys:route");

/** The navigation history stack (`sys:history`). */
export const history = varHandle("sys:history");
