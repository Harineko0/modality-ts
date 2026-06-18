# Real-App Canaries

`canaries.json` is the repository-owned manifest for local example apps and
planned real-app canary slots. Active canaries run through `tools/canary/runner.ts`
and write a `CanaryRunReport`.

## Status meanings

- `active`: the canary root exists and runs through extract/check (and conform
  when configured).
- `planned`: the canary slot is visible for planning but is excluded from
  default runs.

## Editing rules

1. Keep app-specific expectations in manifest data, not runner code.
2. Active canaries must define at least one threshold and an existing root path.
3. Accepted caveats use stable `kind` and `id` values, not free-form message
   regexes.
4. Planned canaries may omit runnable paths; they must stay `status: "planned"`.
5. Seeded-bug acceptance for `examples/demo-app` lives in the manifest
   `expectations` object.

## Validation

`test/canaries/manifest.test.ts` parses `canaries.json` through
`tools/canary/manifest.ts` and enforces reference integrity.

`rtk pnpm ci:canaries` runs active canaries. `rtk pnpm ci:examples` delegates
to the same runner for the demo-app acceptance canary.

There is no `modality canary` CLI command. Canary orchestration is a
repo-maintainer workflow only; see `docs/guides/ci-integration.md`.
