# BUGS_FOUND.md — Open Issues

**Date:** 2026-05-14
**Branch:** main (uncommitted working tree)
**Method:** Static code inspection + Playwright MCP driving the live dev:debug build (CDP port 9222).

Cross-checked every entry in [QA_REPORT.md](QA_REPORT.md) (B-1 … B-30), every milestone in [QA_FIX_PLAN.md](QA_FIX_PLAN.md) (M1.1 … M7.3), and the new "Add Detection at Playhead" feature. **Every actionable bug is fixed.** B-4 and B-5 are working-as-intended per user preference (fixed-height lanes, fixed per-experiment colors).

---

## Info-level (not bugs, but recorded so they don't get re-reported)

### N-3 — DevTools `Autofill.enable` console errors on dev startup

```
"Request Autofill.enable failed. {"code":-32601,"message":"'Autofill.enable' wasn't found"}"
"Request Autofill.setAddresses failed. ..."
```

Electron 37's DevTools sends Chrome's Autofill protocol messages; Electron's CDP backend doesn't implement them. Well-known Electron noise, not a CLAP Desktop issue. Disappears in production (no DevTools).

### N-4 — Launch crash when `ELECTRON_RUN_AS_NODE=1` is set in the shell

If the launching shell has `ELECTRON_RUN_AS_NODE=1` (the local maintainer's environment does), `electron .` runs as plain Node and fails to load Electron's native module via Node 22's ESM/CJS interop:

```
TypeError: Cannot read properties of undefined (reading 'exports')
  at cjsPreparseModuleExports (node:internal/modules/esm/translators:295:81)
```

**Workaround:** unset the variable before launching. PowerShell: `Remove-Item env:ELECTRON_RUN_AS_NODE`. Bash: `unset ELECTRON_RUN_AS_NODE`. Not a code defect — environmental.
