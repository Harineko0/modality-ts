# Disable Router Plugin Still Emits Route State

## Summary

Running extraction with `--disable-plugin router` did not materially remove route state from the GDGJP wiki ingest model. The output still included `sys:route`, `sys:history`, configured route coverage, and route-related state-space contribution.

## Why This Matters

When a model is exploding, users may disable the router plugin expecting to focus on local component state. If route system variables remain present, the flag is surprising and does not provide the expected narrowing lever.

## Reproduction

Use the sibling GDGJP wiki app:

```bash
cd /Users/hari/proj/gdgjp/wiki
rtk node /Users/hari/proj/modality-ts/dist/cli/cli.js extract 'app/routes/ingest.$sessionId.tsx' \
  --disable-plugin router \
  --out .modality/ingest-session.model.json \
  --app-model .modality/ingest-session.model.ts \
  --report .modality/ingest-session.extraction-report.json
```

Observed output still contained route state:

```text
vars 22, transitions 13, routes configured 54, modeled 27, omitted 27
plugin state-source:use-state@0.1.0
state-space≈47.2bits top:sys:pending(24.8),sys:route(4.7),sys:history(2.3)
```

The plugin list no longer showed `router`, but `sys:route` and `sys:history` were still present in the model.

## Expected Behavior

Either `--disable-plugin router` should remove router-derived system variables and route coverage, or the CLI should explain that route system state is injected independently of the router plugin and provide a separate option to disable it.

## Observed Behavior

The flag removed the router plugin from the displayed plugin list, but the generated model still contained route system variables and route coverage metadata.

## Possible Fix Directions

- Make `--disable-plugin router` suppress router system variables, route transitions, and route coverage metadata.
- If route state is core infrastructure rather than plugin-owned, rename or document the flag behavior.
- Add a separate `--no-router-state` or `--no-route-system-vars` option for local-state-only extraction.
- Add a warning when a disabled plugin leaves related system variables in the model.
