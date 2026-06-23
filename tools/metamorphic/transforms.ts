import ts from "typescript";

export interface MetamorphicSite {
  transformId: string;
  siteId: string;
  start: number;
  end: number;
  description: string;
}

export interface TransformedSource {
  site: MetamorphicSite;
  text: string;
}

export interface MetamorphicTransform {
  id: string;
  describe(site: MetamorphicSite): string;
  enumerate(sourceFile: ts.SourceFile): MetamorphicSite[];
  apply(
    sourceFile: ts.SourceFile,
    site?: MetamorphicSite,
  ): TransformedSource | undefined;
}

export function parseSource(
  sourceText: string,
  fileName = "source.tsx",
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function enumerateMetamorphicSites(
  sourceText: string,
  fileName = "source.tsx",
  transformIds?: readonly string[],
): MetamorphicSite[] {
  const sourceFile = parseSource(sourceText, fileName);
  const enabled = new Set(
    transformIds ?? metamorphicTransforms.map((entry) => entry.id),
  );
  return metamorphicTransforms
    .filter((transform) => enabled.has(transform.id))
    .flatMap((transform) => transform.enumerate(sourceFile))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.transformId.localeCompare(right.transformId) ||
        left.siteId.localeCompare(right.siteId),
    );
}

export function applyMetamorphicTransform(
  sourceText: string,
  site: MetamorphicSite,
  fileName = "source.tsx",
): TransformedSource {
  const sourceFile = parseSource(sourceText, fileName);
  const transform = metamorphicTransforms.find(
    (entry) => entry.id === site.transformId,
  );
  if (!transform)
    throw new Error(`unknown metamorphic transform ${site.transformId}`);
  const transformed = transform.apply(sourceFile, site);
  if (!transformed)
    throw new Error(`metamorphic site not found: ${site.siteId}`);
  return transformed;
}

const commentWhitespaceTransform: MetamorphicTransform = {
  id: "comment-whitespace",
  describe: () => "insert inert comment and whitespace",
  enumerate(_sourceFile) {
    return [
      site(
        this.id,
        1,
        0,
        0,
        "insert inert comment and whitespace at file start",
      ),
    ];
  },
  apply(sourceFile, selected) {
    const chosen = selected ?? this.enumerate(sourceFile)[0];
    if (!chosen) return undefined;
    return {
      site: chosen,
      text: `/* modality metamorphic: whitespace/comment invariant */\n\n${sourceFile.getFullText()}`,
    };
  },
};

const localVariableRenameTransform: MetamorphicTransform = {
  id: "local-variable-rename",
  describe: () => "alpha-rename a block-scoped local",
  enumerate(sourceFile) {
    const sites: MetamorphicSite[] = [];
    let index = 0;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        isSafeRenameDeclaration(node, sourceFile)
      ) {
        index += 1;
        sites.push(
          site(
            this.id,
            index,
            node.name.getStart(sourceFile),
            node.name.getEnd(),
            "alpha-rename a non-exported block-scoped local",
          ),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return sites;
  },
  apply(sourceFile, selected) {
    const chosen = selected ?? this.enumerate(sourceFile)[0];
    if (!chosen) return undefined;
    let renamed = false;
    let oldName = "";
    let newName = "";
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const visit: ts.Visitor = (node) => {
        if (
          !renamed &&
          ts.isVariableDeclaration(node) &&
          node.name.getStart(sourceFile) === chosen.start &&
          node.name.getEnd() === chosen.end &&
          ts.isIdentifier(node.name)
        ) {
          oldName = node.name.text;
          newName = `__mm_${oldName}`;
          renamed = true;
          return ts.factory.updateVariableDeclaration(
            node,
            ts.factory.createIdentifier(newName),
            node.exclamationToken,
            node.type,
            node.initializer,
          );
        }
        if (
          renamed &&
          ts.isIdentifier(node) &&
          node.text === oldName &&
          isRenameReference(node)
        ) {
          return ts.factory.createIdentifier(newName);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };
    return printTransformed(sourceFile, chosen, transformer, renamed);
  },
};

const reorderIndependentStatementsTransform: MetamorphicTransform = {
  id: "reorder-independent-statements",
  describe: () => "swap adjacent independent const declarations",
  enumerate(sourceFile) {
    const sites: MetamorphicSite[] = [];
    let index = 0;
    const visit = (node: ts.Node) => {
      if (ts.isBlock(node)) {
        for (let i = 0; i < node.statements.length - 1; i += 1) {
          const left = node.statements[i];
          const right = node.statements[i + 1];
          if (left && right && areIndependentConstStatements(left, right)) {
            index += 1;
            sites.push(
              site(
                this.id,
                index,
                left.getStart(sourceFile),
                right.getEnd(),
                "swap adjacent const declarations with disjoint read/write sets",
              ),
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return sites;
  },
  apply(sourceFile, selected) {
    const chosen = selected ?? this.enumerate(sourceFile)[0];
    if (!chosen) return undefined;
    let swapped = false;
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isBlock(node)) {
          const statements = [...node.statements];
          for (let i = 0; i < statements.length - 1; i += 1) {
            const left = statements[i];
            const right = statements[i + 1];
            if (
              !swapped &&
              left &&
              right &&
              left.getStart(sourceFile) === chosen.start &&
              right.getEnd() === chosen.end &&
              areIndependentConstStatements(left, right)
            ) {
              statements[i] = right;
              statements[i + 1] = left;
              swapped = true;
              break;
            }
          }
          return ts.factory.updateBlock(node, statements);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };
    return printTransformed(sourceFile, chosen, transformer, swapped);
  },
};

const extractSubexpressionToConstTransform: MetamorphicTransform = {
  id: "extract-subexpression-to-const",
  describe: () => "hoist a pure return expression to a const",
  enumerate(sourceFile) {
    const sites: MetamorphicSite[] = [];
    let index = 0;
    const visit = (node: ts.Node) => {
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        ts.isBlock(node.parent) &&
        isPureExpression(node.expression) &&
        !ts.isIdentifier(node.expression) &&
        !ts.isLiteralExpression(node.expression)
      ) {
        index += 1;
        sites.push(
          site(
            this.id,
            index,
            node.expression.getStart(sourceFile),
            node.expression.getEnd(),
            "hoist pure return expression to a const",
          ),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return sites;
  },
  apply(sourceFile, selected) {
    const chosen = selected ?? this.enumerate(sourceFile)[0];
    if (!chosen) return undefined;
    let extracted = false;
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isBlock(node)) {
          const statements: ts.Statement[] = [];
          for (const statement of node.statements) {
            if (
              !extracted &&
              ts.isReturnStatement(statement) &&
              statement.expression &&
              statement.expression.getStart(sourceFile) === chosen.start &&
              statement.expression.getEnd() === chosen.end &&
              isPureExpression(statement.expression)
            ) {
              const name = "__mm_expr";
              statements.push(
                ts.factory.createVariableStatement(
                  undefined,
                  ts.factory.createVariableDeclarationList(
                    [
                      ts.factory.createVariableDeclaration(
                        name,
                        undefined,
                        undefined,
                        statement.expression,
                      ),
                    ],
                    ts.NodeFlags.Const,
                  ),
                ),
              );
              statements.push(
                ts.factory.updateReturnStatement(
                  statement,
                  ts.factory.createIdentifier(name),
                ),
              );
              extracted = true;
            } else {
              statements.push(
                ts.visitEachChild(statement, visit, context) as ts.Statement,
              );
            }
          }
          return ts.factory.updateBlock(node, statements);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };
    return printTransformed(sourceFile, chosen, transformer, extracted);
  },
};

const extractSubcomponentTransform: MetamorphicTransform = {
  id: "extract-subcomponent",
  describe: () => "lift a static JSX subtree to a child component",
  enumerate(sourceFile) {
    const sites: MetamorphicSite[] = [];
    let index = 0;
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxElement(node) &&
        isStaticJsxElement(node) &&
        enclosingFunctionIsHookFree(node)
      ) {
        index += 1;
        sites.push(
          site(
            this.id,
            index,
            node.getStart(sourceFile),
            node.getEnd(),
            "lift static hook-free JSX subtree to a child component",
          ),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return sites;
  },
  apply(sourceFile, selected) {
    const chosen = selected ?? this.enumerate(sourceFile)[0];
    if (!chosen) return undefined;
    let lifted: ts.JsxElement | undefined;
    const componentName = "__MmExtractedSubtree";
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const visit: ts.Visitor = (node) => {
        if (
          !lifted &&
          ts.isJsxElement(node) &&
          node.getStart(sourceFile) === chosen.start &&
          node.getEnd() === chosen.end &&
          isStaticJsxElement(node) &&
          enclosingFunctionIsHookFree(node)
        ) {
          lifted = node;
          return ts.factory.createJsxSelfClosingElement(
            ts.factory.createIdentifier(componentName),
            undefined,
            ts.factory.createJsxAttributes([]),
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => {
        const updated = ts.visitNode(node, visit) as ts.SourceFile;
        if (!lifted) return updated;
        const declaration = ts.factory.createFunctionDeclaration(
          undefined,
          undefined,
          componentName,
          undefined,
          [],
          undefined,
          ts.factory.createBlock(
            [ts.factory.createReturnStatement(lifted)],
            true,
          ),
        );
        return ts.factory.updateSourceFile(updated, [
          ...updated.statements,
          declaration,
        ]);
      };
    };
    return printTransformed(sourceFile, chosen, transformer, false);
  },
};

export const metamorphicTransforms: readonly MetamorphicTransform[] = [
  commentWhitespaceTransform,
  localVariableRenameTransform,
  reorderIndependentStatementsTransform,
  extractSubexpressionToConstTransform,
  extractSubcomponentTransform,
];

function site(
  transformId: string,
  index: number,
  start: number,
  end: number,
  description: string,
): MetamorphicSite {
  return {
    transformId,
    siteId: `${transformId}:${index}:${start}-${end}`,
    start,
    end,
    description,
  };
}

function printTransformed(
  sourceFile: ts.SourceFile,
  site: MetamorphicSite,
  transformer: ts.TransformerFactory<ts.SourceFile>,
  alreadyChanged: boolean,
): TransformedSource | undefined {
  const result = ts.transform(sourceFile, [transformer]);
  try {
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const text = printer.printFile(result.transformed[0]);
    if (!alreadyChanged && text === sourceFile.getFullText()) return undefined;
    return { site, text };
  } finally {
    result.dispose();
  }
}

function isSafeRenameDeclaration(
  node: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  if (!ts.isIdentifier(node.name)) return false;
  if (!node.parent || !ts.isVariableDeclarationList(node.parent)) return false;
  if ((node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0)
    return false;
  const statement = node.parent.parent;
  if (!statement || !ts.isVariableStatement(statement)) return false;
  if (!ts.isBlock(statement.parent)) return false;
  const oldName = node.name.text;
  const newName = `__mm_${oldName}`;
  let safe = true;
  const visit = (current: ts.Node) => {
    if (!safe) return;
    if (current !== node && createsNestedRuntimeScope(current)) return;
    if (ts.isIdentifier(current)) {
      if (current.text === newName) safe = false;
      if (
        current.text === oldName &&
        !isRenameReference(current) &&
        current !== node.name
      ) {
        safe = false;
      }
    }
    if (containsAwait(current)) safe = false;
    ts.forEachChild(current, visit);
  };
  visit(statement.parent);
  return safe && node.name.getStart(sourceFile) >= 0;
}

function isRenameReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  return true;
}

function createsNestedRuntimeScope(node: ts.Node): boolean {
  return (
    ts.isFunctionLike(node) ||
    ts.isClassLike(node) ||
    ts.isArrowFunction(node) ||
    ts.isModuleDeclaration(node)
  );
}

function containsAwait(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (current.kind === ts.SyntaxKind.AwaitExpression) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function areIndependentConstStatements(
  left: ts.Statement,
  right: ts.Statement,
): boolean {
  const leftDecl = singleConstIdentifier(left);
  const rightDecl = singleConstIdentifier(right);
  if (!leftDecl || !rightDecl) return false;
  if (leftDecl.name === rightDecl.name) return false;
  if (
    !isPureExpression(leftDecl.initializer) ||
    !isPureExpression(rightDecl.initializer)
  ) {
    return false;
  }
  if (containsAwait(left) || containsAwait(right)) return false;
  const leftReads = identifiersRead(leftDecl.initializer);
  const rightReads = identifiersRead(rightDecl.initializer);
  return !leftReads.has(rightDecl.name) && !rightReads.has(leftDecl.name);
}

function singleConstIdentifier(statement: ts.Statement):
  | {
      name: string;
      initializer: ts.Expression;
    }
  | undefined {
  if (!ts.isVariableStatement(statement)) return undefined;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0)
    return undefined;
  if (statement.declarationList.declarations.length !== 1) return undefined;
  const declaration = statement.declarationList.declarations[0];
  if (
    !declaration ||
    !ts.isIdentifier(declaration.name) ||
    !declaration.initializer
  ) {
    return undefined;
  }
  return { name: declaration.name.text, initializer: declaration.initializer };
}

function identifiersRead(expression: ts.Expression): Set<string> {
  const reads = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && isRenameReference(node)) reads.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return reads;
}

function isPureExpression(expression: ts.Expression): boolean {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    ts.isIdentifier(expression)
  ) {
    return true;
  }
  if (ts.isParenthesizedExpression(expression))
    return isPureExpression(expression.expression);
  if (ts.isPropertyAccessExpression(expression))
    return isPureExpression(expression.expression);
  if (ts.isElementAccessExpression(expression)) {
    return (
      isPureExpression(expression.expression) &&
      (!expression.argumentExpression ||
        isPureExpression(expression.argumentExpression))
    );
  }
  if (ts.isBinaryExpression(expression)) {
    return (
      isPureBinaryOperator(expression.operatorToken.kind) &&
      isPureExpression(expression.left) &&
      isPureExpression(expression.right)
    );
  }
  if (ts.isPrefixUnaryExpression(expression))
    return isPureExpression(expression.operand);
  if (ts.isConditionalExpression(expression)) {
    return (
      isPureExpression(expression.condition) &&
      isPureExpression(expression.whenTrue) &&
      isPureExpression(expression.whenFalse)
    );
  }
  return false;
}

function isPureBinaryOperator(kind: ts.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.PercentToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ].includes(kind);
}

function isStaticJsxElement(node: ts.JsxElement): boolean {
  let safe = true;
  const visit = (current: ts.Node) => {
    if (!safe) return;
    if (
      ts.isJsxExpression(current) ||
      ts.isJsxSpreadAttribute(current) ||
      ts.isJsxNamespacedName(current)
    ) {
      safe = false;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return safe;
}

function enclosingFunctionIsHookFree(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return !containsHookCall(current);
    current = current.parent;
  }
  return false;
}

function containsHookCall(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      /^use[A-Z0-9]/.test(current.expression.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}
