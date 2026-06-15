import * as ts from "typescript";
import type {
  AbstractDomain,
  Locator,
  Transition,
  Value,
} from "modality-ts/core";
import { exceedsWideNumericThreshold } from "modality-ts/core";
import {
  DEFAULT_INPUT_CLASSES,
  inputClassDomain,
} from "./numeric/abstraction.js";
import { lineAndColumn } from "./ast.js";
import type { SetterBinding } from "./types.js";

export function inputTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setter: SetterBinding,
  locator: Locator | undefined,
): Transition[] {
  const literalValues = literalInputValues(node);
  const inputDomain = effectiveInputDomain(setter.domain);
  const finite = literalValues
    ? finiteInputValues(inputDomain).filter(({ valueClass }) =>
        literalValues.has(valueClass),
      )
    : finiteInputValues(inputDomain);
  if (finite.length > 0) {
    return finite.map(({ value, valueClass }) => ({
      id: `${component}.${attr}.${setter.stateName}.${safeId(valueClass)}`,
      cls: "user" as const,
      label: {
        kind: "input" as const,
        valueClass,
        ...(locator ? { locator } : {}),
      },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit" as const, value: true },
      effect: {
        kind: "assign" as const,
        var: setter.varId,
        expr: { kind: "lit" as const, value },
      },
      reads: [],
      writes: [setter.varId],
      confidence: "exact" as const,
    }));
  }
  return [
    {
      id: `${component}.${attr}.${setter.stateName}`,
      cls: "user",
      label: {
        kind: "input",
        valueClass: valueClassForDomain(inputDomain),
        ...(locator ? { locator } : {}),
      },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect: { kind: "havoc", var: setter.varId },
      reads: [],
      writes: [setter.varId],
      confidence: "over-approx",
    },
  ];
}

function effectiveInputDomain(domain: AbstractDomain): AbstractDomain {
  if (domain.kind === "boundedInt" && exceedsWideNumericThreshold(domain)) {
    return inputClassDomain({ classes: [...DEFAULT_INPUT_CLASSES] });
  }
  return domain;
}

function literalInputValues(
  attribute: ts.JsxAttribute,
): Set<string> | undefined {
  return selectOptionValues(attribute) ?? radioInputValue(attribute);
}

function selectOptionValues(
  attribute: ts.JsxAttribute,
): Set<string> | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const opening = attrs.parent;
  if (
    !ts.isJsxOpeningElement(opening) ||
    opening.tagName.getText() !== "select" ||
    !ts.isJsxElement(opening.parent)
  )
    return undefined;
  const values = opening.parent.children
    .filter(ts.isJsxElement)
    .filter((child) => child.openingElement.tagName.getText() === "option")
    .map((child) => optionValue(child))
    .filter((value): value is string => Boolean(value));
  return values.length > 0 ? new Set(values) : undefined;
}

function optionValue(option: ts.JsxElement): string | undefined {
  const value = stringAttribute(option.openingElement.attributes, "value");
  if (value) return value;
  return simpleElementText(option.openingElement);
}

function radioInputValue(attribute: ts.JsxAttribute): Set<string> | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const opening = attrs.parent;
  if (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening))
    return undefined;
  if (
    opening.tagName.getText() !== "input" ||
    stringAttribute(attrs, "type") !== "radio"
  )
    return undefined;
  const value = stringAttribute(attrs, "value");
  return value ? new Set([value]) : undefined;
}

function finiteInputValues(
  domain: AbstractDomain,
): { value: Value; valueClass: string }[] {
  if (domain.kind === "enum")
    return domain.values.map((value) => ({ value, valueClass: value }));
  if (domain.kind === "boundedInt" && !exceedsWideNumericThreshold(domain)) {
    return Array.from({ length: domain.max - domain.min + 1 }, (_, index) => {
      const value = domain.min + index;
      return { value, valueClass: String(value) };
    });
  }
  if (domain.kind === "bool") {
    return [
      { value: false, valueClass: "false" },
      { value: true, valueClass: "true" },
    ];
  }
  return [];
}

function stringAttribute(
  attrs: ts.JsxAttributes,
  name: string,
): string | undefined {
  const attr = attrs.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name,
  );
  if (!attr?.initializer || !ts.isStringLiteral(attr.initializer))
    return undefined;
  return attr.initializer.text;
}

function simpleElementText(node: ts.Node): string | undefined {
  let text = "";
  const visit = (candidate: ts.Node): void => {
    if (ts.isJsxText(candidate)) text += candidate.text.trim();
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return text || undefined;
}

function valueClassForDomain(domain: AbstractDomain): string {
  if (domain.kind === "lengthCat") return "many";
  if (domain.kind === "bool") return "true";
  if (domain.kind === "enum") return domain.values[0] ?? "value";
  return "nonEmpty";
}

function safeId(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "event"
  );
}
