# React Router Server Imports Inflate Client Models

## Summary

Extracting a React Router route can follow server-side imports from `loader`, `action`, and helper modules into the client model. In the GDGJP wiki ingest route, this added unrelated external fetch operations to `sys:pending`, even though the properties targeted client-side clarification submit behavior.

## Why This Matters

Route modules commonly colocate server and client code. If extraction treats imported server helpers as part of the client transition model, `sys:pending` can include operations that the checked UI component never starts. This inflates the state space, makes `modality check` much harder to run, and obscures the real UI behavior under unrelated API permutations.

## Reproduction

Use the sibling GDGJP wiki app:

```bash
cd /Users/hari/proj/gdgjp/wiki
rtk node /Users/hari/proj/modality-ts/dist/cli/cli.js extract 'app/routes/ingest.$sessionId.tsx' \
  --out .modality/ingest-session.model.json \
  --app-model .modality/ingest-session.model.ts \
  --report .modality/ingest-session.extraction-report.json
```

The extraction succeeds, but reports a large pending domain:

```text
vars 22, transitions 13
state-space≈47.2bits top:sys:pending(24.8),sys:route(4.7),sys:history(2.3)
```

Inspect `sys:pending`:

```bash
rtk node -e 'const m=require("./.modality/ingest-session.model.json"); console.log(JSON.stringify(m.vars.find(v=>v.id==="sys:pending").domain.inner.fields.opId.values, null, 2))'
```

Observed values included operations unrelated to the client clarification form:

```text
GET /https://forms.googleapis.com/v1/forms/:id
GET /https://forms.googleapis.com/v1/forms/:id/responses
GET /https://r.jina.ai/:id
POST /https://fcm.googleapis.com/v1/projects/:id/messages:send
POST /https://oauth2.googleapis.com/token
```

## Expected Behavior

For a route component extraction, Modality should model client-reachable state transitions by default. Server-only `loader`, `action`, and `.server` import effects should either be excluded or placed behind an explicit full-route/server option.

## Observed Behavior

The extracted client model included external operations imported through server-side ingestion code, causing `sys:pending` to dominate the state space.

## Possible Fix Directions

- Treat React Router `loader` and `action` bodies as server-only unless a server-flow extraction mode is requested.
- Do not follow `.server` imports for client component behavior.
- Add an extraction option such as `--client-only`, `--ignore-server-imports`, or `--route-client`.
- Report the import path that contributed each `sys:pending` operation so users can tell whether it belongs to the checked UI surface.
- Provide a first-class pending-operation allowlist or denylist for extraction, not just property-level filtering.
