# Changelog

## 0.2.2 — 2026-08-12

Package rename to `@pitchmachine/mcp-server`. The original name
`@pitchmachine/mcp` was placed under npm's 24-hour name-reserve hold after the
`0.2.0` package was accidentally fully-unpublished (see 0.2.1 note below), and
an immediate republish under the same name returned 404 on PUT. Rather than
wait out the hold, the package moved to `@pitchmachine/mcp-server`, which also
matches the `-server` suffix convention used throughout the MCP ecosystem
(`@modelcontextprotocol/server-*`, etc.).

Install command:

```
npm install -g @pitchmachine/mcp-server
```

Both `pitchmachine-mcp` and `pitchmachine-mcp-server` binaries are exposed, so
existing Claude Desktop / Cursor config snippets from earlier docs continue to
work.

Code is byte-identical to what would have shipped as `0.2.1` / `0.2.0`.

## 0.2.1 — 2026-08-12 (never reached npm)

Housekeeping-only re-release. Code is byte-identical to what was intended for
`0.2.0`. The `0.2.0` version was unpublished from the npm registry within its
72-hour eligibility window after an accidental package-delete (a token cleanup
step landed on the wrong npm settings page). npm blocks re-publishing an
unpublished version number for 24 hours, so this republishes the same content
under `0.2.1`.

No functional, API, or dependency changes vs. the intended `0.2.0`.

## 0.2.0 — 2026-08-12 (unpublished)

- Lead with Bearer token authentication (`PITCHMACHINE_API_TOKEN`), with cookie
  (`PITCHMACHINE_COOKIE`) retained as a compatibility path. Bearer takes
  precedence when both are set.
- README rewritten around the token flow with Claude Desktop / Cursor snippets.
- `scripts/smoke.mjs` gains Bearer-auth end-to-end check; smoke stays out of CI.

## 0.1.1 — 2026-08-11

- Real receiver payload wiring.
- Cookie-forward auth.
- Request timeout fix.
- Honest README rewrite.

## 0.1.0 — 2026-08-11

Initial release.
