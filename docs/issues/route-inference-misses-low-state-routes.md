# Route Inference Misses Low-State Routes

## Summary

The TinyURL route manifest contains more routes than the extracted `sys:route` enum. Redirect-only, API, and low-client-state routes were not represented in `sys:route`.

## Why This Matters

Some important app behavior lives in route loaders or redirect pages rather than client state. If those routes disappear from `sys:route`, route guard and navigation properties may accidentally omit security-sensitive or user-visible paths.

## Reproduction

Compare the app route manifest:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk read app/routes.ts
```

The manifest included:

```text
/
/links
/api/links
/links/:id
/analytics
/tags
/signin
/no-chapter
/api/auth/*
/auth/signout
/auth/signout-iframe
/notfound
/:slug
```

Then extract and inspect the route enum:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(".modality/model.json","utf8")); console.log(JSON.stringify(m.vars.find(v=>v.id==="sys:route").domain.values, null, 2));'
```

Observed extracted routes:

```json
[
  "/",
  "/analytics",
  "/links",
  "/links/:id",
  "/tags"
]
```

Missing examples included `/signin`, `/no-chapter`, `/notfound`, and `/:slug`.

## Expected Behavior

If a route is intentionally omitted, the extraction report should explain why. If route-level behavior is in scope, `sys:route` should include all configured UI routes, including redirect-only pages, so route properties can be explicit.

## Observed Behavior

The route enum included only a subset of routes without an obvious diagnostic explaining omissions.

## Possible Fix Directions

- Emit a route coverage report comparing configured routes to modeled routes.
- Classify omitted routes as API-only, redirect-only, no-client-state, unsupported, or unreachable.
- Add an option to include low-state routes in `sys:route` even when they have no modeled local state.
- Add properties or report warnings for route manifests where configured routes are absent from the model.
