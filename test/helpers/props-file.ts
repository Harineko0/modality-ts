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
  variable,
} from "modality-ts/properties";`;

export function propsFileBody(...statements: string[]): string {
  return `${PROPERTIES_IMPORT}\n\n${statements.join("\n")}\n`;
}

export const flagFalseProperty = `always("flagStartsFalseOnly", eq(variable("flag"), false));`;
export const flagTrueProperty = `reachable("flagCanBecomeTrue", eq(variable("flag"), true));`;
export const flagFalseReachableProperty = `reachable("flagAlreadyFalse", eq(variable("flag"), false));`;
export const flagAlwaysFalseProperty = `always("flagAlwaysFalse", eq(variable("flag"), false));`;
export const flagOkProperty = `always("flagOk", eq(variable("flag"), false));`;
export const reachableFromFlagProperty = `reachableFrom("flagCannotReturnFalse", eq(variable("flag"), true), eq(variable("flag"), false));`;
export const panelReachableProperty = `reachable("panelReachable", eq(variable("local:panel"), true));`;
export const amountKnownProperty = `always("amountKnown", eq(variable("amount"), "validSmall"));`;
export const idNotBlockedProperty = `always("idNotBlocked", eq(variable("session").at("user", "id"), "blocked"));`;

export const registrationPropsMjs = `import { reachable, eq, variable } from "modality-ts/properties";
reachable("flagCanBecomeTrue", eq(variable("flag"), true));
`;
