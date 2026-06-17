# Absolute props paths can exceed import-cache filename limits

## Context

While checking the Meiwa tenant properties from `~/proj/modality-ts`, passing absolute paths for both the model and property file caused the property loader to generate an overlong cache filename.

Command shape:

```bash
npx modality check \
  ~/proj/magica/curoco/frontend/tenant-meiwa/.modality/models/src/app/settings/attributes/AttributesSettingsPage/index.model.json \
  ~/proj/magica/curoco/frontend/tenant-meiwa/src/app/settings/attributes/AttributesSettingsPage/index.props.ts \
  --report ~/proj/magica/curoco/frontend/tenant-meiwa/.modality/models/src/app/settings/attributes/AttributesSettingsPage/check-report.json \
  --no-search-limits
```

Observed error:

```text
ENAMETOOLONG: name too long, open '~/proj/modality-ts/.modality/import-cache/...696e6465782e70726f70732e7473....mjs'
```

Running the same check from the tenant app root with relative paths avoided the issue.

## Expected

The import cache filename should remain bounded regardless of whether the user passes relative or absolute property paths.

## Suggested Fix

Hash the normalized property path for cache filenames instead of embedding the whole path as hex.
