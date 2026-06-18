# Conformance Fixtures

Canonical semantic fixtures live under `test/conformance/fixtures/<fixture-id>/`.

## Layout

```text
test/conformance/fixtures/<fixture-id>/
  fixture.json
  app/
    App.tsx or route files
    app.props.ts or *.props.ts
    package.json when dependency facts matter
    tsconfig.json when compiler behavior matters
```

`fixture.json` records:

- fixture and matrix ids (`id`, `featureIds`, `targetIds`, `root`);
- source and props paths relative to the fixture root;
- extract, check, and conform command options;
- thresholds, budgets, and semantic expectations.

Semantic expectations name facts such as transition ids or prefixes, variable
scopes and domains, effect read kinds, navigate targets, coverage thresholds,
conform pass rates, and state-space contributor counts. They do not snapshot
full reports.

## When to add a fixture

Add a fixture when:

1. a semantic matrix row becomes `supported`;
2. a canary failure reveals missing fixture coverage;
3. a regression needs a canonical semantic proof.

## What stays out

Do not commit:

- full app snapshots;
- generated `.modality` output;
- dependency lockfiles unless a dependency fact is the point of the fixture.

The conformance runner writes generated models, reports, traces, and matrix
reports to temporary directories outside fixture roots.

## Running fixtures

```bash
rtk pnpm ci:conformance
rtk pnpm ci:conformance -- --fixture <fixture-id>
```

Matrix wiring and validation live in `test/conformance/matrix.json` and
`tools/conformance/manifest.ts`.
