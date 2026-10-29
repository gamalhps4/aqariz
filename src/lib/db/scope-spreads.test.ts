/**
 * No query writes a scope and a column that scope is keyed on into the same
 * object literal.
 *
 * `withScope` only fixes the call sites that use it. Over a hundred others
 * still spread a scope into their `where`, and each is safe for one reason:
 * the scope's columns and the literal's own happen to differ. An id beside a
 * contract scope — `{ id, ...leaseScope(user) }` — is an id and a tenant or a
 * building, never two claims on one column. That is precisely what stopped
 * being true for buildings, whose scope is keyed on `id`, under comments that
 * went on saying "intersected".
 *
 * So this reads the source instead of the comments. It fails when
 *
 *   - a literal names a column its spread scope can come back keyed on;
 *   - a scope is spread beside something whose keys cannot be seen from here;
 *   - something merely named like a scope — a parameter, a property — is
 *     spread beside other keys, where it cannot be traced to a rule;
 *   - a scope is merged in with `Object.assign`;
 *   - a column is assigned over a scope after the fact;
 *   - an `AND` is written over a `where` a scope was already AND-ed onto;
 *   - a scope function this file has never heard of is spread at all,
 *
 * and when lib/db/scopes.ts exports a scope the table below does not list, so
 * the table cannot fall behind it unnoticed.
 *
 * Names are followed by ordinary lexical scoping within one file, through
 * every value a variable is given — its initialiser and any later
 * reassignment. A parameter or a property named like a scope (`leaseScope`,
 * or `paymentWhere` as scopes are held here) cannot be followed, and is
 * treated as a scope of unknown columns; rename it if it is not one.
 *
 * What it cannot see: a scope that reaches a query under a name that says
 * nothing — returned from a helper called `base()`, passed in as `filters` —
 * or a `where` reached through an alias. It narrows the ways to write this
 * mistake; scripts/verify-staff-scope.ts is what counts the rows.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Every column each scope can come back keyed on, over all the callers it
 * has: a tenant, an owner, an employee narrowed to some buildings.
 */
const SCOPE_COLUMNS: Record<string, readonly string[]> = {
  propertyScope: ["id", "leases"],
  leaseScope: ["tenantId", "propertyId"],
  invoiceScope: ["tenantId", "propertyId"],
  paymentScope: ["tenantId", "propertyId"],
  expenseScope: ["propertyId"],
  maintenanceScope: ["tenantId", "propertyId"],
  applicationScope: ["applicantId", "propertyId"],
  securityDepositScope: ["tenantId", "propertyId"],
  inspectionScope: ["tenantId", "propertyId"],
  feedbackScope: ["userId"],
  tenantRecordScope: ["id", "leasesAsTenant"],
  ownerRecordScope: ["id", "propertiesOwned"],
  ticketScope: ["tenantId", "propertyId"],
  compoundScope: ["properties"],
  agreementScope: ["id", "ownerId", "OR"],
  // archive.service's switch over the scopes above, one per category.
  categoryScope: [
    "id",
    "leases",
    "properties",
    "property",
    "tenantId",
    "propertyId",
    "OR",
  ],
};

/**
 * Queries known to collide that are left for another change, by their exact
 * finding — anything else in the same file is still reported.
 *
 * None today. The agreement report was the last: it wrote the requested
 * building after the caller's scope and so replaced it, until it moved to
 * applyScope.
 */
const KNOWN_COLLISIONS: ReadonlyArray<{
  file: string;
  problem: string;
  count: number;
}> = [];

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src");

interface Finding {
  file: string;
  line: number;
  problem: string;
}

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // The generated client is not ours to read, and a test may write the
      // mistake down on purpose.
      if (entry.name !== "generated") sourceFiles(absolute, found);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      found.push(absolute);
    }
  }
  return found;
}

/** `x as const`, `x satisfies T`, `x!` and `(x)` are all still `x`. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function calledName(node: ts.Expression): string | null {
  const call = unwrap(node);
  if (!ts.isCallExpression(call)) return null;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** Whether a declared name — plain, or destructured — introduces `name`. */
function declares(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && declares(element.name, name),
  );
}

/** What a name stands for, as far as this file can tell. */
type Meaning =
  | { kind: "value"; declaration: ts.VariableDeclaration }
  | { kind: "unknown" };

/**
 * The declaration a name refers to where it is used: the nearest enclosing
 * block, loop or function that declares it. A parameter, a destructured
 * name or an import is found and reported as unknown, so that an outer
 * variable of the same name is never mistaken for it.
 */
function meaningOf(identifier: ts.Identifier): Meaning {
  const name = identifier.text;
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      if (scope.parameters.some((parameter) => declares(parameter.name, name))) {
        return { kind: "unknown" };
      }
    }
    if (
      ts.isCatchClause(scope) &&
      scope.variableDeclaration &&
      declares(scope.variableDeclaration.name, name)
    ) {
      return { kind: "unknown" };
    }

    const lists: ts.VariableDeclarationList[] = [];
    if (
      ts.isBlock(scope) ||
      ts.isSourceFile(scope) ||
      ts.isModuleBlock(scope) ||
      ts.isCaseClause(scope) ||
      ts.isDefaultClause(scope)
    ) {
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement)) {
          lists.push(statement.declarationList);
        }
      }
    }
    if (
      (ts.isForStatement(scope) ||
        ts.isForOfStatement(scope) ||
        ts.isForInStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer)
    ) {
      lists.push(scope.initializer);
    }

    for (const list of lists) {
      for (const declaration of list.declarations) {
        if (!declares(declaration.name, name)) continue;
        return ts.isIdentifier(declaration.name)
          ? { kind: "value", declaration }
          : { kind: "unknown" };
      }
    }
  }
  return { kind: "unknown" };
}

/** One thing an object literal writes. */
type Entry =
  | { kind: "key"; name: string; order: number }
  | { kind: "scope"; name: string; order: number }
  | { kind: "untraced"; text: string; order: number }
  | { kind: "opaque"; text: string; order: number };

/** The key a literal carries once a scope has been AND-ed onto it. */
const CARRIED_AND = "…AND";

function scan(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relative = path.relative(ROOT, file);
  const findings: Finding[] = [];
  const report = (node: ts.Node, problem: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    findings.push({ file: relative, line: line + 1, problem });
  };

  /** `applyScope(where, …)`: which declaration it was called on, and where. */
  const appliedAt = new Map<ts.VariableDeclaration, number>();
  /** Every value each variable is given: its initialiser, and reassignments. */
  const values = new Map<ts.VariableDeclaration, ts.Expression[]>();
  const give = (declaration: ts.VariableDeclaration, value: ts.Expression) =>
    values.set(declaration, [...(values.get(declaration) ?? []), value]);
  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      give(node, node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const meaning = meaningOf(node.left);
      if (meaning.kind === "value") give(meaning.declaration, node.right);
    }
    if (ts.isCallExpression(node) && calledName(node) === "applyScope") {
      const target = node.arguments[0];
      if (target && ts.isIdentifier(target)) {
        const meaning = meaningOf(target);
        if (meaning.kind === "value" && !appliedAt.has(meaning.declaration)) {
          appliedAt.set(meaning.declaration, node.getStart());
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  /** Which scope an expression is, if it is one — through names and `?:`. */
  const scopeOf = (
    node: ts.Expression,
    seen: Set<ts.Node> = new Set(),
  ): string | null => {
    const value = unwrap(node);
    if (seen.has(value)) return null;
    seen.add(value);

    const called = calledName(value);
    if (called && called in SCOPE_COLUMNS) return called;
    if (ts.isConditionalExpression(value)) {
      return scopeOf(value.whenTrue, seen) ?? scopeOf(value.whenFalse, seen);
    }
    if (ts.isBinaryExpression(value)) {
      const operator = value.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        return scopeOf(value.right, seen);
      }
      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return scopeOf(value.left, seen) ?? scopeOf(value.right, seen);
      }
    }
    if (ts.isIdentifier(value)) {
      for (const given of valuesOf(value)) {
        const scope = scopeOf(given, seen);
        if (scope) return scope;
      }
    }
    return null;
  };

  /** Every value a name was given, as far as this file shows. */
  const valuesOf = (identifier: ts.Identifier): ts.Expression[] => {
    const meaning = meaningOf(identifier);
    return meaning.kind === "value"
      ? (values.get(meaning.declaration) ?? [])
      : [];
  };

  /** The object literals a name was given, if any. */
  const literalsOf = (identifier: ts.Identifier): ts.ObjectLiteralExpression[] =>
    valuesOf(identifier)
      .map(unwrap)
      .filter((value): value is ts.ObjectLiteralExpression =>
        ts.isObjectLiteralExpression(value),
      );

  /** Whether a scope has been AND-ed onto this name by the time it is used. */
  const carriesScope = (identifier: ts.Identifier): boolean => {
    const meaning = meaningOf(identifier);
    if (meaning.kind !== "value") return false;
    if (
      valuesOf(identifier).some((value) => calledName(value) === "withScope")
    ) {
      return true;
    }
    const applied = appliedAt.get(meaning.declaration);
    return applied !== undefined && applied < identifier.getStart();
  };

  /**
   * A name that says it is a scope — `scope`, `leaseScope`, or the
   * `paymentWhere` / `propertyWhere` this codebase keeps scopes in — but
   * cannot be followed: a parameter, something destructured or imported, a
   * property. A plain `where` is any query's clause, and is not suspect.
   */
  const scopeLikeName = (name: string) =>
    /scope$/i.test(name) || /[a-z]Where$/.test(name);
  const looksLikeScope = (value: ts.Expression): boolean => {
    if (ts.isPropertyAccessExpression(value)) {
      return scopeLikeName(value.name.text);
    }
    return (
      ts.isIdentifier(value) &&
      meaningOf(value).kind === "unknown" &&
      scopeLikeName(value.text)
    );
  };

  /** Everything a literal writes, looking through the spreads it can. */
  const entriesOf = (
    literal: ts.ObjectLiteralExpression,
    seen: Set<ts.Node> = new Set(),
  ): Entry[] => {
    const entries: Entry[] = [];
    let order = 0;

    const spread = (node: ts.Expression) => {
      const value = unwrap(node);
      const scope = scopeOf(value);
      if (scope) {
        entries.push({ kind: "scope", name: scope, order });
        return;
      }
      const called = calledName(value);
      if (called && /Scope$/.test(called)) {
        report(
          value,
          `spreads ${called}(), which this test does not know — add it to SCOPE_COLUMNS`,
        );
        return;
      }
      if (ts.isObjectLiteralExpression(value)) {
        for (const inner of entriesOf(value, seen)) {
          entries.push({ ...inner, order });
        }
        return;
      }
      // `...(cond ? { a } : {})` and `...(cond && { a })`
      if (ts.isConditionalExpression(value)) {
        spread(value.whenTrue);
        spread(value.whenFalse);
        return;
      }
      if (
        ts.isBinaryExpression(value) &&
        (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      ) {
        spread(value.right);
        if (value.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
          spread(value.left);
        }
        return;
      }
      if (ts.isIdentifier(value)) {
        const literals = literalsOf(value).filter((literal) => !seen.has(literal));
        for (const literal of literals) {
          seen.add(literal);
          for (const inner of entriesOf(literal, seen)) {
            entries.push({ ...inner, order });
          }
        }
        if (carriesScope(value)) {
          entries.push({ kind: "key", name: CARRIED_AND, order });
          return;
        }
        if (literals.length > 0) return;
      }
      // Called a scope, but not one this file can follow back to its rule.
      // Its columns are anyone's guess.
      if (looksLikeScope(value)) {
        entries.push({ kind: "untraced", text: value.getText(source), order });
        return;
      }
      entries.push({ kind: "opaque", text: value.getText(source), order });
    };

    for (const property of literal.properties) {
      order += 1;
      if (ts.isSpreadAssignment(property)) {
        spread(property.expression);
      } else if (property.name && ts.isComputedPropertyName(property.name)) {
        entries.push({
          kind: "opaque",
          text: property.name.getText(source),
          order,
        });
      } else if (property.name) {
        entries.push({
          kind: "key",
          name: ts.isStringLiteral(property.name)
            ? property.name.text
            : property.name.getText(source),
          order,
        });
      }
    }
    return entries;
  };

  const check = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const entries = entriesOf(node);
      const scopes = entries.filter((entry) => entry.kind === "scope");

      for (const scope of scopes) {
        const columns = SCOPE_COLUMNS[scope.name];
        for (const entry of entries) {
          if (entry === scope) continue;
          if (entry.kind === "key" && columns.includes(entry.name)) {
            report(
              node,
              entry.order < scope.order
                ? `\`${entry.name}\` is written before ${scope.name}, which can overwrite it`
                : `\`${entry.name}\` is written after ${scope.name} and overwrites it`,
            );
          }
          if (entry.kind === "scope" && entry.order > scope.order) {
            const shared = SCOPE_COLUMNS[entry.name].filter((column) =>
              columns.includes(column),
            );
            if (shared.length > 0) {
              report(
                node,
                `${scope.name} and ${entry.name} are both keyed on \`${shared.join("`, `")}\``,
              );
            }
          }
          if (entry.kind === "opaque") {
            report(
              node,
              `${scope.name} is spread beside \`${entry.text}\`, whose keys cannot be seen — use withScope`,
            );
          }
        }
      }

      for (const entry of entries) {
        if (entry.kind === "untraced" && entries.length > 1) {
          report(
            node,
            `\`${entry.text}\` is spread beside other keys and cannot be traced to a rule — use withScope`,
          );
        }
      }

      // `{ ...where, AND: [...] }` over a where that already carries a scope.
      const carried = entries.find(
        (entry) => entry.kind === "key" && entry.name === CARRIED_AND,
      );
      const own = entries.find(
        (entry) => entry.kind === "key" && entry.name === "AND",
      );
      if (carried && own && own.order > carried.order) {
        report(node, "`AND` is written over a where a scope was AND-ed onto");
      }
    }

    // `Object.assign(where, scope)` is the same spread under another name —
    // and so is `Object.assign(where, { propertyId })` onto a where built
    // from a scope. A plain copy, `Object.assign({}, scope)`, is neither.
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "Object.assign"
    ) {
      const [target, ...sources] = node.arguments;
      const bareTarget = target ? unwrap(target) : undefined;
      const copy =
        bareTarget !== undefined &&
        ts.isObjectLiteralExpression(bareTarget) &&
        bareTarget.properties.length === 0 &&
        sources.length === 1;
      if (!copy) {
        for (const argument of node.arguments) {
          const scope = scopeOf(argument);
          if (scope) {
            report(
              node,
              `${scope} is merged with Object.assign, which overwrites like a spread`,
            );
          }
        }
      }
      if (bareTarget && ts.isIdentifier(bareTarget)) {
        const carried = literalsOf(bareTarget)
          .flatMap((literal) => entriesOf(literal))
          .filter((entry) => entry.kind === "scope");
        for (const scope of carried) {
          for (const source of sources) {
            const value = unwrap(source);
            if (!ts.isObjectLiteralExpression(value)) continue;
            for (const entry of entriesOf(value)) {
              if (
                entry.kind === "key" &&
                SCOPE_COLUMNS[scope.name].includes(entry.name)
              ) {
                report(
                  node,
                  `\`${entry.name}\` is merged over ${scope.name} with Object.assign`,
                );
              }
            }
          }
        }
      }
    }

    // `where.column = …` and `where["column"] = …`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target = node.left;
      const owner =
        (ts.isPropertyAccessExpression(target) ||
          ts.isElementAccessExpression(target)) &&
        ts.isIdentifier(target.expression)
          ? target.expression
          : null;
      const column = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ts.isElementAccessExpression(target) &&
            ts.isStringLiteralLike(target.argumentExpression)
          ? target.argumentExpression.text
          : null;

      if (owner && column) {
        // Assigned over a literal that was built by spreading a scope keyed
        // on that column — whichever of the values the name was given.
        for (const literal of literalsOf(owner)) {
          for (const entry of entriesOf(literal)) {
            if (
              entry.kind === "scope" &&
              SCOPE_COLUMNS[entry.name].includes(column)
            ) {
              report(
                node,
                `\`${owner.text}.${column}\` is assigned over ${entry.name}, which is keyed on it`,
              );
            }
          }
        }
        // `where.AND = …` after a scope was AND-ed onto `where`.
        if (column === "AND" && carriesScope(owner)) {
          report(
            node,
            `\`${owner.text}.AND\` is assigned after a scope was AND-ed onto it`,
          );
        }
      }
    }

    ts.forEachChild(node, check);
  };
  check(source);

  return findings;
}

function describeFindings(findings: Finding[]): string {
  return findings
    .map((finding) => `  ${finding.file}:${finding.line}  ${finding.problem}`)
    .join("\n");
}

/** The findings not covered by KNOWN_COLLISIONS — each entry by its count. */
function unexpectedFindings(findings: Finding[]): Finding[] {
  const allowance = new Map(
    KNOWN_COLLISIONS.map((known) => [`${known.file}\n${known.problem}`, known.count]),
  );
  return findings.filter((finding) => {
    const key = `${finding.file}\n${finding.problem}`;
    const left = allowance.get(key) ?? 0;
    if (left === 0) return true;
    allowance.set(key, left - 1);
    return false;
  });
}

describe("scopes in the source", () => {
  // Anything that says "scope" at all: a scope can be spread in a file that
  // never calls one.
  const files = sourceFiles(SOURCE_ROOT).filter((file) =>
    /scope/i.test(fs.readFileSync(file, "utf8")),
  );
  const findings = files.flatMap((file) =>
    scan(file, fs.readFileSync(file, "utf8")),
  );

  test("the files that use a scope were found", () => {
    // A wrong working directory would otherwise pass by reading nothing.
    assert.ok(files.length > 50, `only ${files.length} files read from ${SOURCE_ROOT}`);
  });

  test("none collides with a column written beside it", () => {
    const unexpected = unexpectedFindings(findings);
    assert.equal(
      unexpected.length,
      0,
      [
        "",
        "A scope and the request's own keys overwrite each other here.",
        "AND the scope on with withScope or applyScope (lib/db/scope-where.ts):",
        describeFindings(unexpected),
        "",
      ].join("\n"),
    );
  });

  test("every scope lib/db/scopes.ts exports is in the table", () => {
    const scopes = fs.readFileSync(
      path.join(SOURCE_ROOT, "lib/db/scopes.ts"),
      "utf8",
    );
    const exported = [...scopes.matchAll(/export function (\w+Scope)\(/g)].map(
      (match) => match[1],
    );
    assert.ok(exported.length >= 12, "no scope functions found in scopes.ts");
    assert.deepEqual(
      exported.filter((name) => !(name in SCOPE_COLUMNS)),
      [],
      "add these to SCOPE_COLUMNS, with every column they can be keyed on",
    );
  });
});

describe("the reader itself", () => {
  const problems = (code: string) =>
    scan(path.join(ROOT, "src/example.ts"), code).map(
      (finding) => finding.problem,
    );

  test("sees a requested id beside the building scope", () => {
    assert.deepEqual(
      problems("db.property.findFirst({ where: { id, ...propertyScope(user) } });"),
      ["`id` is written before propertyScope, which can overwrite it"],
    );
  });

  test("sees a filter written after a scope, in a conditional spread too", () => {
    assert.deepEqual(
      problems(`const where = {
        ...leaseScope(actor),
        ...(propertyId ? { propertyId } : {}),
      };`),
      ["`propertyId` is written after leaseScope and overwrites it"],
    );
  });

  test("follows a scope held in a variable, and a literal held in one", () => {
    assert.deepEqual(
      problems(`const leaseWhere = leaseScope(user);
        db.lease.count({ where: { propertyId: { in: ids }, ...leaseWhere } });`),
      ["`propertyId` is written before leaseScope, which can overwrite it"],
    );
    assert.deepEqual(
      problems(`const MINE = { tenantId: id } as const;
        db.lease.count({ where: { ...MINE, ...leaseScope(user) } });`),
      ["`tenantId` is written before leaseScope, which can overwrite it"],
    );
    assert.deepEqual(
      problems(`const scope = restricted ? paymentScope(user) : {};
        db.payment.count({ where: { ...scope, tenantId } });`),
      ["`tenantId` is written after paymentScope and overwrites it"],
    );
  });

  test("refuses a scope beside a spread it cannot see into", () => {
    assert.deepEqual(
      problems(`function sum(match: object) {
          return db.payment.aggregate({ where: { ...match, ...paymentScope(user) } });
        }`),
      [
        "paymentScope is spread beside `match`, whose keys cannot be seen — use withScope",
      ],
    );
  });

  test("refuses a scope it cannot trace back to its rule", () => {
    assert.deepEqual(
      problems(`function find(where: object, scope: object) {
          return db.lease.findFirst({ where: { ...where, ...scope } });
        }`),
      [
        "`scope` is spread beside other keys and cannot be traced to a rule — use withScope",
      ],
    );
    assert.deepEqual(
      problems("const where = { propertyId, ...options.leaseScope };"),
      [
        "`options.leaseScope` is spread beside other keys and cannot be traced to a rule — use withScope",
      ],
    );
  });

  test("sees a scope merged in with Object.assign", () => {
    assert.deepEqual(
      problems(`const where = { id };
        Object.assign(where, propertyScope(user));`),
      ["propertyScope is merged with Object.assign, which overwrites like a spread"],
    );
  });

  test("sees a column assigned over a scope afterwards", () => {
    assert.deepEqual(
      problems(`const baseWhere = { ...paymentScope(actor) };
        if (propertyId) baseWhere.propertyId = propertyId;`),
      [
        "`baseWhere.propertyId` is assigned over paymentScope, which is keyed on it",
      ],
    );
    assert.deepEqual(
      problems(`const baseWhere = { ...paymentScope(actor) };
        baseWhere["tenantId"] = tenantId;`),
      [
        "`baseWhere.tenantId` is assigned over paymentScope, which is keyed on it",
      ],
    );
  });

  test("follows a variable through its reassignments", () => {
    assert.deepEqual(
      problems(`let where: object = {};
        if (restricted) where = { ...paymentScope(user) };
        if (propertyId) where.propertyId = propertyId;`),
      ["`where.propertyId` is assigned over paymentScope, which is keyed on it"],
    );
    assert.deepEqual(
      problems(`let scope = {};
        if (restricted) scope = leaseScope(user);
        db.lease.count({ where: { ...scope, tenantId } });`),
      ["`tenantId` is written after leaseScope and overwrites it"],
    );
  });

  test("refuses a where handed in under a scope's name", () => {
    assert.deepEqual(
      problems(`const total = (paymentWhere: object, ids: string[]) =>
          db.payment.aggregate({ where: { ...paymentWhere, propertyId: { in: ids } } });`),
      [
        "`paymentWhere` is spread beside other keys and cannot be traced to a rule — use withScope",
      ],
    );
  });

  test("sees keys merged over a scope with Object.assign, and lets a copy be", () => {
    assert.deepEqual(
      problems(`const where = { ...leaseScope(user) };
        Object.assign(where, { propertyId });`),
      ["`propertyId` is merged over leaseScope with Object.assign"],
    );
    assert.deepEqual(problems("const copy = Object.assign({}, leaseScope(user));"), []);
  });

  test("tells two variables of one name apart", () => {
    // The assignment is in the first function; a later, unrelated `where`
    // must not hide it — nor be blamed for it.
    assert.deepEqual(
      problems(`function first() {
          const where = { ...paymentScope(actor) };
          if (propertyId) where.propertyId = propertyId;
          return where;
        }
        function second() {
          const where = { status: "paid" };
          where.propertyId = propertyId;
          return where;
        }`),
      ["`where.propertyId` is assigned over paymentScope, which is keyed on it"],
    );
  });

  test("sees an AND written over a where that carries a scope", () => {
    assert.deepEqual(
      problems(`const base = withScope({ deletedAt: null }, leaseScope(actor));
        const where = { ...base, AND: [{ endDate: { gte: today } }] };`),
      ["`AND` is written over a where a scope was AND-ed onto"],
    );
    assert.deepEqual(
      problems(`const where = { deletedAt: null };
        applyScope(where, leaseScope(user));
        where.AND = [{ status }];`),
      ["`where.AND` is assigned after a scope was AND-ed onto it"],
    );
  });

  test("flags a scope function it has not been told about", () => {
    assert.deepEqual(problems("const where = { id, ...unitScope(user) };"), [
      "spreads unitScope(), which this test does not know — add it to SCOPE_COLUMNS",
    ]);
  });

  test("passes what is safe", () => {
    assert.deepEqual(
      problems(`const propertyWhere = propertyScope(user);
        const where: Record<string, unknown> = { deletedAt: null };
        db.lease.findFirst({ where: { id, ...leaseScope(user) } });
        db.property.findMany({ where: { deletedAt: null, ...propertyWhere } });
        db.property.findFirst({ where: withScope({ id }, propertyScope(user)) });
        where.AND = [{ OR: search }];
        applyScope(where, tenantRecordScope(user));
        where.propertyId = propertyId;
        db.lease.count({ where: { ...where, status } });
        const held = propertyScope(user);
        db.property.count({ where: { compoundId: id, NOT: held } });`),
      [],
    );
  });
});
