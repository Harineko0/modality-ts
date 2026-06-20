import type { Locator } from "modality-ts/core";
import * as ts from "typescript";
import { safeId } from "../ids.js";
import { semanticTextForEventAttribute } from "./ui.js";

export function semanticEventName(
  attribute: ts.JsxAttribute,
  handlerName: string | undefined,
  locator: Locator | undefined,
): string | undefined {
  return (
    handlerName ??
    semanticTextForEventAttribute(attribute) ??
    semanticTextForLocator(locator)
  );
}

export function transitionIdFromSemanticName(
  component: string,
  attr: string,
  semanticName: string | undefined,
  fallbackSegment: string,
  suffix = "",
): string {
  return `${component}.${attr}.${semanticName ?? fallbackSegment}${suffix}`;
}

export function dependencyNameSegment(
  dependencyArray: ts.Expression | undefined,
): string | undefined {
  if (!dependencyArray || !ts.isArrayLiteralExpression(dependencyArray)) {
    return undefined;
  }
  const names = dependencyArray.elements
    .map((element) => dependencyName(element))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join("_") : undefined;
}

function semanticTextForLocator(locator: Locator | undefined): string | undefined {
  if (!locator) return undefined;
  if (locator.kind === "role" && locator.name) return locator.name;
  if (locator.kind === "testId") return locator.value;
  return undefined;
}

function dependencyName(element: ts.Expression): string | undefined {
  if (ts.isIdentifier(element)) return element.text;
  if (ts.isPropertyAccessExpression(element)) return safeId(element.getText());
  return undefined;
}
