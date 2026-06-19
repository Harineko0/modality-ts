export const PROPERTIES_IMPORT = `import {
  always,
  alwaysStep,
  eq,
  leadsToWithin,
  neq,
  not,
  reachable,
  reachableFrom,
  stepAny,
  stepEnqueued,
  stepResolved,
  varHandle,
} from "modality-ts/properties";`;

export function propsFileBody(...statements: string[]): string {
  return `${PROPERTIES_IMPORT}\n\n${statements.join("\n")}\n`;
}

export const flagFalseProperty = `always("flagStartsFalseOnly", eq(varHandle("flag"), false));`;
export const flagTrueProperty = `reachable("flagCanBecomeTrue", eq(varHandle("flag"), true));`;
export const flagFalseReachableProperty = `reachable("flagAlreadyFalse", eq(varHandle("flag"), false));`;
export const flagAlwaysFalseProperty = `always("flagAlwaysFalse", eq(varHandle("flag"), false));`;
export const flagOkProperty = `always("flagOk", eq(varHandle("flag"), false));`;
export const reachableFromFlagProperty = `reachableFrom("flagCannotReturnFalse", eq(varHandle("flag"), true), eq(varHandle("flag"), false));`;
export const panelReachableProperty = `reachable("panelReachable", eq(varHandle("local:panel"), true));`;
export const amountKnownProperty = `always("amountKnown", eq(varHandle("amount"), "validSmall"));`;
export const idNotBlockedProperty = `always("idNotBlocked", eq(varHandle("session").at("user", "id"), "blocked"));`;

export const registrationPropsMjs = `import { reachable, eq, varHandle } from "modality-ts/properties";
reachable("flagCanBecomeTrue", eq(varHandle("flag"), true));
`;
