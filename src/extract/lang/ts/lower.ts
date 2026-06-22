import * as ts from "typescript";
import type { Value } from "modality-ts/core";
import { nodeRefFor } from "./node-ref.js";
import type {
  SurfaceBinding,
  SurfaceExpr,
  SurfaceFunction,
  SurfaceModule,
  SurfaceParam,
  SurfaceStmt,
  SymbolRef,
} from "./surface-ir.js";

type SurfaceBlock = Extract<SurfaceStmt, { kind: "block" }>;

function symbolRef(node: ts.Identifier, fileName: string): SymbolRef {
  return { name: node.text, origin: nodeRefFor(node, fileName) };
}

function literalValue(node: ts.Expression): Value | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  return undefined;
}

function lowerExpr(
  node: ts.Expression,
  fileName: string,
): SurfaceExpr {
  const origin = nodeRefFor(node, fileName);
  const literal = literalValue(node);
  if (literal !== undefined) return { kind: "literal", value: literal };
  if (ts.isIdentifier(node)) {
    return { kind: "ref", symbol: symbolRef(node, fileName) };
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const name = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : node.argumentExpression.getText();
    return {
      kind: "member",
      object: lowerExpr(node.expression, fileName),
      name,
      origin,
    };
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const callee = node.expression ?? (node as ts.NewExpression).expression;
    return {
      kind: "call",
      callee: lowerExpr(callee, fileName),
      args: (node.arguments ?? []).map((arg) =>
        ts.isIdentifier(arg) || ts.isExpression(arg)
          ? lowerExpr(arg as ts.Expression, fileName)
          : { kind: "opaque", origin: nodeRefFor(arg, fileName) },
      ),
      origin,
    };
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.getText();
    if (op === "&&" || op === "||" || op === "??") {
      return {
        kind: "logical",
        op,
        left: lowerExpr(node.left, fileName),
        right: lowerExpr(node.right, fileName),
        origin,
      };
    }
    return {
      kind: "binary",
      op,
      left: lowerExpr(node.left, fileName),
      right: lowerExpr(node.right, fileName),
      origin,
    };
  }
  if (ts.isPrefixUnaryExpression(node)) {
    return {
      kind: "unary",
      op: ts.tokenToString(node.operator) ?? node.operator.toString(),
      operand: lowerExpr(node.operand, fileName),
      origin,
    };
  }
  if (ts.isPostfixUnaryExpression(node)) {
    return {
      kind: "unary",
      op: ts.tokenToString(node.operator) ?? node.operator.toString(),
      operand: lowerExpr(node.operand, fileName),
      origin,
    };
  }
  if (ts.isConditionalExpression(node)) {
    return {
      kind: "ternary",
      test: lowerExpr(node.condition, fileName),
      whenTrue: lowerExpr(node.whenTrue, fileName),
      whenFalse: lowerExpr(node.whenFalse, fileName),
      origin,
    };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const fields: { name: string; value: SurfaceExpr }[] = [];
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : prop.name.getText();
      fields.push({ name, value: lowerExpr(prop.initializer, fileName) });
    }
    return { kind: "object", fields, origin };
  }
  if (ts.isArrayLiteralExpression(node)) {
    return {
      kind: "array",
      elements: node.elements
        .filter((el): el is ts.Expression => !ts.isOmittedExpression(el))
        .map((el) => lowerExpr(el, fileName)),
      origin,
    };
  }
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    return lowerJsx(node, fileName);
  }
  if (ts.isParenthesizedExpression(node)) {
    return lowerExpr(node.expression, fileName);
  }
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return lowerExpr(node.expression, fileName);
  }
  return { kind: "opaque", origin };
}

function jsxTagName(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  const tag = node.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text;
  return tag.getText();
}

function lowerJsx(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  fileName: string,
): SurfaceExpr {
  const origin = nodeRefFor(node, fileName);
  if (ts.isJsxSelfClosingElement(node)) {
    return {
      kind: "jsx",
      tag: jsxTagName(node),
      attrs: lowerJsxAttributes(node.attributes, fileName),
      children: [],
      origin,
    };
  }
  const children: SurfaceExpr[] = [];
  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      const text = child.text.trim();
      if (text) {
        children.push({ kind: "literal", value: text });
      }
      continue;
    }
    if (ts.isJsxExpression(child) && child.expression) {
      children.push(lowerExpr(child.expression, fileName));
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      children.push(lowerJsx(child, fileName));
    }
  }
  return {
    kind: "jsx",
    tag: jsxTagName(node.openingElement),
    attrs: lowerJsxAttributes(node.openingElement.attributes, fileName),
    children,
    origin,
  };
}

function lowerJsxAttributes(
  attrs: ts.JsxAttributes,
  fileName: string,
): { name: string; value?: SurfaceExpr }[] {
  const out: { name: string; value?: SurfaceExpr }[] = [];
  for (const attr of attrs.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    const name = attr.name.getText();
    if (!attr.initializer) {
      out.push({ name });
      continue;
    }
    if (ts.isStringLiteral(attr.initializer)) {
      out.push({ name, value: { kind: "literal", value: attr.initializer.text } });
      continue;
    }
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      out.push({
        name,
        value: lowerExpr(attr.initializer.expression, fileName),
      });
    }
  }
  return out;
}

function lowerBinding(
  decl: ts.VariableDeclaration,
  fileName: string,
): SurfaceBinding | undefined {
  if (!ts.isIdentifier(decl.name)) return undefined;
  return {
    name: decl.name.text,
    ...(decl.initializer
      ? { init: lowerExpr(decl.initializer, fileName) }
      : {}),
    origin: nodeRefFor(decl.name, fileName),
  };
}

export function lowerStatement(
  statement: ts.Statement,
  fileName: string,
): SurfaceStmt {
  if (ts.isBlock(statement)) {
    return {
      kind: "block",
      stmts: statement.statements.map((s) => lowerStatement(s, fileName)),
    };
  }
  if (ts.isIfStatement(statement)) {
    return {
      kind: "if",
      cond: lowerExpr(statement.expression, fileName),
      // biome-ignore lint/suspicious/noThenProperty: Surface IR mirrors Effect IR branch naming.
      then: lowerStatement(statement.thenStatement, fileName),
      ...(statement.elseStatement
        ? { else: lowerStatement(statement.elseStatement, fileName) }
        : {}),
    };
  }
  if (ts.isSwitchStatement(statement)) {
    const cases: { test?: SurfaceExpr; body: SurfaceStmt }[] = [];
    for (const clause of statement.caseBlock.clauses) {
      const body: SurfaceStmt = {
        kind: "block",
        stmts: clause.statements.map((s) => lowerStatement(s, fileName)),
      };
      if (ts.isDefaultClause(clause)) {
        cases.push({ body });
      } else {
        cases.push({
          test: lowerExpr(clause.expression, fileName),
          body,
        });
      }
    }
    return { kind: "switch", disc: lowerExpr(statement.expression, fileName), cases };
  }
  if (ts.isForStatement(statement)) {
    return {
      kind: "for",
      ...(statement.initializer
        ? {
            init: ts.isVariableDeclarationList(statement.initializer)
              ? {
                  kind: "declare" as const,
                  bindings: statement.initializer.declarations
                    .map((d) => lowerBinding(d, fileName))
                    .filter((b): b is SurfaceBinding => Boolean(b)),
                }
              : {
                  kind: "expr" as const,
                  expr: lowerExpr(statement.initializer as ts.Expression, fileName),
                },
          }
        : {}),
      ...(statement.condition
        ? { cond: lowerExpr(statement.condition, fileName) }
        : {}),
      ...(statement.incrementor
        ? { update: lowerExpr(statement.incrementor, fileName) }
        : {}),
      body: lowerStatement(statement.statement, fileName),
      loopKind: "for",
    };
  }
  if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
    const initBindings =
      ts.isVariableDeclarationList(statement.initializer)
        ? statement.initializer.declarations
            .map((d) => lowerBinding(d, fileName))
            .filter((b): b is SurfaceBinding => Boolean(b))
        : [];
    return {
      kind: "for",
      ...(initBindings.length
        ? { init: { kind: "declare" as const, bindings: initBindings } }
        : {}),
      body: lowerStatement(statement.statement, fileName),
      loopKind: ts.isForOfStatement(statement) ? "forOf" : "forIn",
    };
  }
  if (ts.isWhileStatement(statement)) {
    return {
      kind: "for",
      cond: lowerExpr(statement.expression, fileName),
      body: lowerStatement(statement.statement, fileName),
      loopKind: "while",
    };
  }
  if (ts.isDoStatement(statement)) {
    return {
      kind: "for",
      cond: lowerExpr(statement.expression, fileName),
      body: lowerStatement(statement.statement, fileName),
      loopKind: "doWhile",
    };
  }
  if (ts.isReturnStatement(statement)) {
    return {
      kind: "return",
      ...(statement.expression
        ? { value: lowerExpr(statement.expression, fileName) }
        : {}),
    };
  }
  if (ts.isVariableStatement(statement)) {
    return {
      kind: "declare",
      bindings: statement.declarationList.declarations
        .map((d) => lowerBinding(d, fileName))
        .filter((b): b is SurfaceBinding => Boolean(b)),
    };
  }
  if (ts.isExpressionStatement(statement)) {
    return { kind: "expr", expr: lowerExpr(statement.expression, fileName) };
  }
  if (ts.isThrowStatement(statement)) {
    return { kind: "throw", origin: nodeRefFor(statement, fileName) };
  }
  if (ts.isBreakStatement(statement)) {
    return { kind: "break", origin: nodeRefFor(statement, fileName) };
  }
  if (ts.isContinueStatement(statement)) {
    return { kind: "continue", origin: nodeRefFor(statement, fileName) };
  }
  if (ts.isTryStatement(statement)) {
    return { kind: "tryish", origin: nodeRefFor(statement, fileName) };
  }
  if (ts.isEmptyStatement(statement)) {
    return { kind: "block", stmts: [] };
  }
  if (ts.isLabeledStatement(statement)) {
    return lowerStatement(statement.statement, fileName);
  }
  return { kind: "opaque", origin: nodeRefFor(statement, fileName) };
}

function lowerFunctionBody(
  body: ts.ConciseBody,
  fileName: string,
): SurfaceStmt {
  if (ts.isBlock(body)) {
    return lowerStatement(body, fileName);
  }
  return { kind: "expr", expr: lowerExpr(body, fileName) };
}

export function lowerFunction(
  node:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression
    | ts.MethodDeclaration,
  fileName: string,
): SurfaceFunction | undefined {
  const params: SurfaceParam[] = [];
  for (const param of node.parameters) {
    if (!ts.isIdentifier(param.name)) continue;
    params.push({
      name: param.name.text,
      origin: nodeRefFor(param.name, fileName),
    });
  }
  const name = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
    ? node.name && ts.isIdentifier(node.name)
      ? node.name.text
      : undefined
    : undefined;
  if (!node.body) return undefined;
  return {
    ...(name ? { name } : {}),
    params,
    body: lowerFunctionBody(node.body, fileName),
    origin: nodeRefFor(node, fileName),
  };
}

export function lowerModule(
  source: ts.SourceFile,
  fileName = source.fileName,
): SurfaceModule {
  const decls: SurfaceModule["decls"] = [];
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.body
    ) {
      const fn = lowerFunction(statement, fileName);
      if (fn) {
        decls.push({ kind: "function", fn });
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      decls.push({
        kind: "var",
        bindings: statement.declarationList.declarations
          .map((d) => lowerBinding(d, fileName))
          .filter((b): b is SurfaceBinding => Boolean(b)),
        origin: nodeRefFor(statement, fileName),
      });
    }
  }
  return { decls };
}

export function lowerBlock(
  block: ts.Block,
  fileName: string,
): SurfaceBlock {
  const stmt = lowerStatement(block, fileName);
  if (stmt.kind === "block") return stmt;
  return { kind: "block", stmts: [stmt] };
}

export { lowerExpr };
