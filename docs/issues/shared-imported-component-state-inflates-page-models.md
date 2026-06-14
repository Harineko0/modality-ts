# Shared Imported Component State Inflates Page Models

## Summary

Extracting route pages in the TinyURL app pulled in state from shared components and app shell controls. That made page-level checking less isolated than expected and increased the model size.

## Why This Matters

Developers expect `app/routes/analytics.props.mjs` to primarily check the analytics page. Instead, the extracted model included state from shared components such as dialog controls, tag comboboxes, theme provider, mobile navigation, and chart tabs. This makes a page property pay the cost of unrelated UI state.

## Reproduction

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(".modality/model.json","utf8")); for (const v of m.vars) console.log(v.id)'
```

Representative variables in the app-wide model included:

```text
local:AnalyticsDateButton.open
local:AnalyticsFilterButton.open
local:TabbedBarCard.active
local:CreateLinkDialog.open
local:CreateLinkForm.destinationUrl
local:MobileBar.navOpen
local:TagCombobox.open
local:Calendar.anchor
local:ThemeProvider.theme
local:Dashboard.scope
local:EditLink.draft
local:ShareForm.principalType
local:Tags.createOpen
local:CreateTagForm.scope
```

The generated model source locations also showed merged route sources for shared component transitions. For example, transition source file strings included many route files together:

```text
app/routes/$slug.tsx,app/routes/analytics.tsx,app/routes/dashboard.tsx,app/routes/home.tsx,app/routes/links.$id.tsx,...
```

## Expected Behavior

Page-level extraction or props-file inference should make it possible to check a route with only the route's relevant imported component state, or at least provide a clear way to exclude unrelated shared shell state.

## Observed Behavior

The extracted model was broad enough that even checking a single props file could run out of memory.

## Possible Fix Directions

- Add a route-scoped extraction mode that starts from one page and excludes unrelated route entries.
- Improve slicing before search so variables and transitions irrelevant to a props file are removed.
- Add an ignore mechanism for known shell state, such as theme, mobile nav, and menu state.
- Preserve per-source provenance more precisely so users can see which route actually imports a given stateful component.
- Provide a report section listing top state-space contributors by variable/domain.
