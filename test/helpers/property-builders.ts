import {
  always as registerAlways,
  alwaysStep as registerAlwaysStep,
  finalizeProperties,
  harvest,
  leadsToWithin as registerLeadsToWithin,
  reachable as registerReachable,
  reachableFrom as registerReachableFrom,
  resetRegistry,
  type Model,
  type Operand,
  type Property,
  type PropertyOptions,
  type StepPredicateFlat,
  type StepPredicateIR,
} from "modality-ts/core";

function finalizeOne(model: Model): Property {
  const properties = finalizeProperties(model, harvest());
  if (properties.length !== 1) {
    throw new Error(`expected 1 property, got ${properties.length}`);
  }
  return properties[0]!;
}

function withoutName(options: PropertyOptions): PropertyOptions {
  const { name: _name, ...rest } = options;
  return rest;
}

export function always(
  model: Model,
  predicate: Operand,
  options: PropertyOptions = {},
): Property {
  resetRegistry();
  registerAlways(options.name ?? "always", predicate, withoutName(options));
  return finalizeOne(model);
}

export function alwaysStep(
  model: Model,
  predicate: StepPredicateIR,
  options: PropertyOptions = {},
): Property {
  resetRegistry();
  registerAlwaysStep(
    options.name ?? "alwaysStep",
    predicate,
    withoutName(options),
  );
  return finalizeOne(model);
}

export function reachable(
  model: Model,
  predicate: Operand,
  options: PropertyOptions = {},
): Property {
  resetRegistry();
  registerReachable(
    options.name ?? "reachable",
    predicate,
    withoutName(options),
  );
  return finalizeOne(model);
}

export function reachableFrom(
  model: Model,
  when: Operand,
  goal: Operand,
  options: PropertyOptions = {},
): Property {
  resetRegistry();
  registerReachableFrom(
    options.name ?? "reachableFrom",
    when,
    goal,
    withoutName(options),
  );
  return finalizeOne(model);
}

export function leadsToWithin(
  model: Model,
  trigger: StepPredicateFlat,
  goal: Operand,
  options: PropertyOptions & {
    budget: { steps?: number; environment?: number };
    allowUserEvents?: boolean;
  },
): Property {
  resetRegistry();
  registerLeadsToWithin(
    options.name ?? "leadsToWithin",
    trigger,
    goal,
    options,
  );
  return finalizeOne(model);
}

export {
  and,
  eq,
  greaterThan,
  greaterThanOrEqual,
  lessThan,
  lessThanOrEqual,
  lit,
  neq,
  not,
  or,
  pre,
  readOpArg,
  readPreVar,
  readVar,
  variable,
  enabled,
  enabledTransitionPrefix,
  stepAny,
  stepChanged,
  stepChangedTo,
  stepEnqueued,
  stepResolved,
  stepTransitionId,
} from "modality-ts/core";
