# Extraction fails on commented tsconfig.json

## Status

Open. A local code fix was applied during the Meiwa tenant investigation, but this should be covered by regression tests before closing.

## Reproduction

From `~/proj/magica/curoco/frontend/tenant-meiwa` before the fix:

```bash
npx modality extract src/app/login/LoginForm.tsx \
  --out .modality/models/login/LoginForm.model.json \
  --app-model .modality/models/login/app.model.ts \
  --report .modality/models/login/extraction-report.json
```

The app's `tsconfig.json` contains normal TypeScript comments. Extraction failed before source analysis with:

```text
Expected property name or '}' in JSON at position 26 (line 3 column 3)
```

## Expected

The extractor should parse TSConfig files as JSONC, matching TypeScript and Next.js behavior.

## Actual

`readTsConfigResolution` used `JSON.parse` on `tsconfig.json`, so any commented TSConfig blocked extraction.

## Notes

The local working tree now uses `ts.parseConfigFileTextToJson` in `src/cli/features/extract/command.ts`. Add a fixture with comments in `tsconfig.json` to lock this in.
