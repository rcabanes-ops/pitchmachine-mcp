# `@pitchmachine/mcp`

**Model Context Protocol server for [Pitch Machine](https://pitchmachine.ai).**
Build hyper-personalized pitch microsites from any AI agent — Claude Desktop,
Cursor, Grok Bot, Continue, or any other MCP host.

The agent creates the receiver, generates the microsite, and hands you back a
public URL. Sending is deliberately left to you (or to the agent, via its own
channels) — Pitch Machine gets out of the way after the artifact is ready.

---

## Status: honest disclosure

`v0.1.1` (this release) is the *shipping-what-actually-works* release. If
you were about to install `v0.1.0`: don't. It called the wrong receiver
endpoint and sent the wrong auth header, and every first tool call would
have failed. That's on us. Details in [CHANGELOG](#changelog).

The auth flow in `v0.1.x` is deliberately ugly — you copy a browser cookie
value into a config file. It works, it's honest, and it will be replaced
by a proper agent-token surface in `v0.2.0` (targeted this week). See
[Roadmap](#roadmap).

---

## What you get

Four tools:

| Tool | What it does |
|---|---|
| `pitchmachine_create_receiver` | Adds a prospect (B2B) or an individual (B2C). |
| `pitchmachine_generate_pitch` | Kicks off generation and polls until the microsite is deployed. |
| `pitchmachine_get_pitch_url` | Fetches the public share URL for any pitch, past or in-progress. |
| `pitchmachine_list_pitches` | Lists recent pitches with status and URL. |

**No send tool.** On purpose. See [the /agents page](https://pitchmachine.ai/#/agents)
for the reasoning; short version: platform email deliverability is still on
its warmup arc, and we'd rather hand you an artifact than a low-deliverability
outbox.

---

## Install & configure (v0.1.x — cookie forwarding)

Pitch Machine's server authenticates the browser via an HttpOnly session
cookie called `pm_pitcher_sess`. Until the API-token endpoint ships in
`v0.2.0`, the MCP forwards the *value* of that cookie on every request.
You have to copy it out of DevTools once and paste it into your MCP host's
config. The cookie is valid for 14 days; then you re-copy.

### 1. Sign in and copy the cookie value

1. Open [pitchmachine.ai](https://pitchmachine.ai) in Chrome, Edge, Firefox
   or Safari and sign in.
2. Open DevTools (`F12` or `Cmd+Opt+I`).
3. **Application** tab → **Cookies** → `https://pitchmachine.ai`.
   *(Firefox: **Storage** tab. Safari: enable Develop menu first.)*
4. Find the row named `pm_pitcher_sess`. Copy the **Value** column. It
   looks like `v2.abcd1234-....hmac_signature_here` (5 dot-separated parts).

That value is your credential. Treat it like a password.

### 2. Point your MCP host at `@pitchmachine/mcp`

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pitchmachine": {
      "command": "npx",
      "args": ["-y", "@pitchmachine/mcp"],
      "env": {
        "PITCHMACHINE_SESSION_COOKIE": "v2.abcd1234...hmac_signature_here"
      }
    }
  }
}
```

Restart Claude Desktop. The four tools appear in the tools panel.

#### Cursor

`.cursor/mcp.json` at your repo root (or the global equivalent):

```json
{
  "mcpServers": {
    "pitchmachine": {
      "command": "npx",
      "args": ["-y", "@pitchmachine/mcp"],
      "env": {
        "PITCHMACHINE_SESSION_COOKIE": "v2.abcd1234...hmac_signature_here"
      }
    }
  }
}
```

#### Grok Bot / any other MCP host

The stdio command is the same. Point your host at `npx -y @pitchmachine/mcp`
with `PITCHMACHINE_SESSION_COOKIE` in the environment.

### 3. Verify with the smoke script

Before trusting the install in an agent workflow, run the live smoke test:

```bash
export PITCHMACHINE_SESSION_COOKIE="v2.abcd1234...hmac_signature_here"
npx -y @pitchmachine/mcp --smoke     # coming in the tarball, see scripts/smoke.mjs
```

This lists your recent pitches over the real API. If it prints an array,
your cookie is good and the endpoint path is right. If it prints
`401 unauthorized`, the cookie is stale — re-sign-in and re-copy.

---

## Example agent flows

**"Pitch this URL to our warm lead."**

The agent calls, in order:

1. `pitchmachine_create_receiver` with the prospect's company, contact email,
   and any notes.
2. `pitchmachine_generate_pitch` with the returned `receiver_id`.
3. When the tool returns `status: "deployed"` and `public_url`, the agent
   drops the link into your Slack / email draft / task tracker of choice.

**"What did I generate this week?"**

`pitchmachine_list_pitches` with `since` set to the start of the week.
Returns pitch IDs, statuses, and URLs for each.

**"Resume that pitch that took forever."**

`pitchmachine_get_pitch_url` with the `pitch_id` from a prior run.

---

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PITCHMACHINE_SESSION_COOKIE` | ✅ in v0.1.x | — | Value of the `pm_pitcher_sess` browser cookie. |
| `PITCHMACHINE_API_TOKEN` | ✅ in v0.2.0+ | — | Long-lived agent token from Settings → Agent access. Reserved; no server support yet. |
| `PITCHMACHINE_API_BASE` | ❌ | `https://pitchmachine.ai` | Point at staging or a local dev server. |
| `PITCHMACHINE_REQUEST_TIMEOUT_MS` | ❌ | `30000` | Per-request HTTP timeout (ms). |

If both `PITCHMACHINE_API_TOKEN` and `PITCHMACHINE_SESSION_COOKIE` are set,
the token wins. That precedence lets you migrate to `v0.2.0` without
first deleting the old env var.

---

## Development

```bash
npm install
npm run build
npm test              # vitest, 100% mocked — 36 tests
npm run inspector     # open the MCP inspector against the built server
```

The unit tests are network-free. The client injects a fake `fetch`; tool
tests inject a stub client. That's what guards against regressions in the
code we own, but it does *not* prove the client talks to a real Pitch
Machine server correctly — that's what `scripts/smoke.mjs` is for. Every
release must pass both.

---

## Changelog

### v0.1.1 (2026-08-12)

- **Fixed:** receiver creation called `POST /api/v2/receivers`. The server
  exposes `POST /api/receivers` (no `/v2/`). Every first tool call in
  `v0.1.0` 404'd.
- **Fixed:** auth header. `v0.1.0` sent `Authorization: Bearer <supabase-jwt>`.
  The Pitch Machine server does not read that header — it authenticates
  via the `pm_pitcher_sess` HttpOnly cookie. `v0.1.1` forwards the cookie
  value directly. Install steps updated.
- **Fixed:** `PITCHMACHINE_REQUEST_TIMEOUT_MS` was silently ignored (env
  parser wrote `requestTimeoutMs`, main read `timeoutMs`). Both fixed and
  a regression test pinned.
- **Added:** `PITCHMACHINE_SESSION_COOKIE` env var. `PITCHMACHINE_API_TOKEN`
  is reserved for `v0.2.0`.
- **Added:** live smoke script at `scripts/smoke.mjs`. Run it before
  trusting the install.
- **Added:** 11 more tests (36 total). Auth-header shape and env precedence
  are now pinned.

### v0.1.0 (2026-08-11) — do not use

Compiled, tested, published; did not actually work end-to-end because
of the two bugs above. Yanked from install docs. Kept on npm as a
version-history artifact.

---

## Roadmap

- **v0.1.x** (now): four tools, stdio transport, cookie-forwarded session auth.
- **v0.2.0** (this week): `/api/agent/token` endpoint, `pitcher_agent_tokens`
  table, Settings → Agent access UI, real long-lived `Authorization: Bearer`
  auth. `PITCHMACHINE_SESSION_COOKIE` stays supported for one minor version
  after that as a fallback.
- **v0.5**: HTTP + SSE transport for hosted deployments.
- **v1.0**: `pitchmachine_send_pitch` — once platform email deliverability is
  ready. Follow along at [pitchmachine.ai/#/agents](https://pitchmachine.ai/#/agents).

---

## License

MIT © [Pitch Machine](https://pitchmachine.ai)
