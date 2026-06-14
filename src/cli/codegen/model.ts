import {
  canonicalJson,
  type AbstractDomain,
  type Model,
  type StateVarDecl,
  type Value,
} from "modality-ts/core";

export function emitAppModel(model: Model): string {
  return [
    'import type { Model } from "modality-ts/core";',
    "",
    `export const M = ${canonicalJson(model)} as const satisfies Model;`,
    "",
    "export type AppState = {",
    ...model.vars.map(
      (decl) => `  ${quoteProperty(decl.id)}: ${typeForDomain(decl.domain)};`,
    ),
    "};",
    "",
    "export type VarId = keyof AppState;",
    "",
    `export const initialState = ${canonicalJson(initialState(model.vars))} as const satisfies AppState;`,
    "",
  ].join("\n");
}

function typeForDomain(domain: AbstractDomain): string {
  switch (domain.kind) {
    case "bool":
      return "boolean";
    case "enum":
      return domain.values.length > 0
        ? domain.values.map(stringLiteralType).join(" | ")
        : "never";
    case "boundedInt":
      return domain.min === domain.max ? JSON.stringify(domain.min) : "number";
    case "option":
      return `${typeForDomain(domain.inner)} | null`;
    case "record":
      return `{ ${Object.entries(domain.fields)
        .map(
          ([key, field]) => `${quoteProperty(key)}: ${typeForDomain(field)};`,
        )
        .join(" ")} }`;
    case "tagged":
      return (
        Object.entries(domain.variants)
          .map(([tagValue, variant]) => {
            const body =
              variant.kind === "record"
                ? Object.entries(variant.fields)
                    .map(
                      ([key, field]) =>
                        `${quoteProperty(key)}: ${typeForDomain(field)};`,
                    )
                    .join(" ")
                : `value: ${typeForDomain(variant)};`;
            return `{ ${quoteProperty(domain.tag)}: ${stringLiteralType(tagValue)}; ${body} }`;
          })
          .join(" | ") || "never"
      );
    case "tokens":
      return domain.names?.length
        ? domain.names.map(stringLiteralType).join(" | ")
        : "string";
    case "lengthCat":
      return '"0" | "1" | "many"';
    case "boundedList":
      return `readonly ${parenthesizeIfUnion(typeForDomain(domain.inner))}[]`;
  }
}

function initialState(vars: readonly StateVarDecl[]): Record<string, Value> {
  return Object.fromEntries(vars.map((decl) => [decl.id, decl.initial]));
}

function quoteProperty(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
}

function stringLiteralType(value: string): string {
  return JSON.stringify(value);
}

function parenthesizeIfUnion(value: string): string {
  return value.includes(" | ") ? `(${value})` : value;
}
