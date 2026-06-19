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
  var as stateVar,
} from "modality-ts/properties";`;

export function propsFileBody(...statements: string[]): string {
  return `${PROPERTIES_IMPORT}\n\n${statements.join("\n")}\n`;
}

export const flagFalseProperty = `always("flagStartsFalseOnly", eq(stateVar("flag"), false));`;
export const flagTrueProperty = `reachable("flagCanBecomeTrue", eq(stateVar("flag"), true));`;
export const flagFalseReachableProperty = `reachable("flagAlreadyFalse", eq(stateVar("flag"), false));`;
export const flagAlwaysFalseProperty = `always("flagAlwaysFalse", eq(stateVar("flag"), false));`;
export const flagOkProperty = `always("flagOk", eq(stateVar("flag"), false));`;
export const reachableFromFlagProperty = `reachableFrom("flagCannotReturnFalse", eq(stateVar("flag"), true), eq(stateVar("flag"), false));`;
export const panelReachableProperty = `reachable("panelReachable", eq(stateVar("local:panel"), true));`;
export const amountKnownProperty = `always("amountKnown", eq(stateVar("amount"), "validSmall"));`;
export const idNotBlockedProperty = `always("idNotBlocked", eq(stateVar("session").at("user", "id"), "blocked"));`;

export const registrationPropsMjs = `import { reachable, eq, var as stateVar } from "modality-ts/properties";
reachable("flagCanBecomeTrue", eq(stateVar("flag"), true));
`;
