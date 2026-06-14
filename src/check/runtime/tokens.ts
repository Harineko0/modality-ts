import { enumerateDomain } from "modality-ts/core";
import type { Model, ModelState, Value } from "modality-ts/core";

export class TokenExhausted extends Error {
  constructor(readonly domainOf: string) {
    super(`token cap exhausted for ${domainOf}`);
  }
}

export function freshToken(model: Model, state: ModelState, domainOf: string): string {
  const decl = model.vars.find((candidate) => candidate.id === domainOf);
  if (!decl || decl.domain.kind !== "tokens") {
    throw new Error(`freshToken domainOf must reference token var: ${domainOf}`);
  }
  const names = enumerateDomain(decl.domain) as string[];
  const tokenSet = new Set(names);
  const used = new Set<string>();
  for (const value of Object.values(state)) collectTokens(value, used, tokenSet);
  const fresh = names.find((name) => !used.has(name));
  if (!fresh) throw new TokenExhausted(domainOf);
  return fresh;
}

function collectTokens(value: Value, out: Set<string>, tokenSet: ReadonlySet<string>): void {
  if (typeof value === "string" && tokenSet.has(value)) out.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectTokens(item, out, tokenSet));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectTokens(item, out, tokenSet));
}
