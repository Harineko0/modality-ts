# Conformance Matrix

`matrix.json` is the repository-owned semantic conformance matrix. It records
which behavioral capabilities the project models, which adapter or library
columns exercise them, and how honestly complete that coverage is today.

## Status meanings

- `supported`: a canonical fixture under `test/conformance/fixtures/` proves the
  capability for the target column. Plan 22-2 adds those fixtures; until then
  no cell should claim `supported` without a real fixture id.
- `partial`: behavior exists in extraction, checking, or focused tests but lacks
  a canonical fixture.
- `unsupported`: the capability is known absent for the target.
- `not-applicable`: the target cannot meaningfully exercise the row.

## Editing rules

1. Feature ids describe behavior, not library marketing names.
2. Every `supported` cell must name at least one fixture id defined in
   `fixtures`.
3. Fixture, feature, and target references must stay internally consistent.
4. Mark gaps honestly; the matrix is planning data, not an aspirational
   checklist.

## Validation

`test/conformance/matrix.test.ts` parses `matrix.json` through
`tools/conformance/manifest.ts` and enforces reference integrity.
