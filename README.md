# `@pitchmachine/mcp`

**Model Context Protocol server for [Pitch Machine](https://pitchmachine.ai).**
Build hyper-personalized pitch microsites from any AI agent — Claude Desktop,
Cursor, Grok Bot, Continue, or any other MCP host.

The agent creates the receiver, generates the microsite, and hands you back a
public URL. Sending is deliberately left to you (or to the agent, via its own
channels) — Pitch Machine gets out of the way after the artifact is ready.

---

## Status

`v0.2.0` — the friendly-install release.

Auth is now a long-lived agent token you mint inside the app at
**Settings → Agent access**. Copy once, paste into your MCP host config,
done. Cookie forwarding from `v0.1.x` still works as a compatibility path
but is no longer the recommended flow. See [Roadmap](#roadmap) for what's
next.

If you were on `v0.1.0`: don't use it. It called the wrong receiver
endpoint and sent the wrong auth header, and every first tool call would
have failed. Fixed in `v0.1.1`; details in [CHANGELOG](#changelog).

---

## What you get

Four tools:

| Tool | What it does |
|---|---|
| `pitchmachine_create_receiver` | Adds a receiver (a company + one contact human). Same shape as the production form; `company_name` is the only required field. Set `audience_mode: "b2c"` and fill the B2C-only strings for personal-book receivers. |
| `pitchmachine_generate_pitch` | Kicks off generation and polls until the microsite is deployed. |
| `pitchmachine_get_pitch_url` | Fetches the public share URL for any pitch, past or in-progress. |
| `pitchmachine_list_pitches` | Lists recent pitches with status and URL. |

**No send tool.** On purpose. See [the /agents page](https://pitchmachine.ai/#/agents)
for the reasoning; short version: platform email deliverability is still on
its warmup arc, and we'd rather hand you an artifact than a low-deliverability
outbox.

---

## Install & configure — recommended flow (v0.2.0+)

### 1. Mint an agent token

1. Sign in at [pitchmachine.ai](https://pitchmachine.ai).
2. Go to **Settings → Agent access**.
3. Click **Mint token**, name it after where it'll live (e.g. `Claude on my
   laptop`), optionally set an expiry.
4. **Copy the plaintext token.** It's shown exactly once. Format:
   `pm_agent_live_<24 base62 chars>`.

Treat the token like a password. It's tied to your pitcher, not a device;
revoke and re-mint from Settings if it ever leaks.

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
        "PITCHMACHINE_API_TOKEN": "pm_agent_live_replace_with_your_token"
      }
    }
  }
}
```

Restart Claude Desktop. The four tools appear in the tools panel.

The **Copy for Claude Desktop** button in Settings → Agent access hands you
this exact JSON block with the token already filled in.

#### Cursor

`.cursor/mcp.json` at your repo root (or the global equivalent):

```json
{
  "mcpServers": {
    "pitchmachine": {
      "command": "npx",
      "args": ["-y", "@pitchmachine/mcp"],
      "env": {
        "PITCHMACHINE_API_TOKEN": "pm_agent_live_replace_with_your_token"
      }
    }
  }
}
```

#### Grok Bot / any other MCP host

The stdio command is the same. Point your host at `npx -y @pitchmachine/mcp`
with `PITCHMACHINE_API_TOKEN` in the environment.

### 3. Verify with the smoke script

Before trusting the install in an agent workflow, run the live smoke test:

```bash
export PITCHMACHINE_API_TOKEN="pm_agent_live_replace_with_your_token"
git clone https://github.com/rcabanes-ops/pitchmachine-mcp
cd pitchmachine-mcp && npm install && npm run build && npm run smoke
```

This lists your recent pitches over the real API. If it prints an array,
your token is good and the endpoint path is right. If it prints
`401 unauthorized`, the token was revoked or never existed.

---

## Advanced / compatibility path — cookie forwarding (v0.1.x)

Still supported. Use this if you're on a Pitch Machine build that predates
Settings → Agent access, or if you want a one-off check without minting a
token. The cookie is valid for 14 days; re-copy after that.

<details>
<summary>Cookie install steps</summary>

1. Sign in at [pitchmachine.ai](https://pitchmachine.ai).
2. Open DevTools (`F12` or `Cmd+Opt+I`).
3. **Application** tab → **Cookies** → `https://pitchmachine.ai`.
   *(Firefox: **Storage** tab. Safari: enable Develop menu first.)*
4. Find `pm_pitcher_sess`. Copy the **Value** column.
5. In your MCP host config, use `PITCHMACHINE_SESSION_COOKIE` instead of
   `PITCHMACHINE_API_TOKEN`:

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

If both env vars are set, the agent token wins.

</details>

---

## Example agent flows

**"Pitch this URL to our warm lead."**

The agent calls, in order:

1. `pitchmachine_create_receiver` with `company_name`, `person_name`, `person_email`,
   and any `notes`.
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
| `PITCHMACHINE_API_TOKEN` | ✅ recommended (v0.2.0+) | — | Long-lived agent token from Settings → Agent access. Format: `pm_agent_live_<24 base62>`. |
| `PITCHMACHINE_SESSION_COOKIE` | ✅ compatibility only | — | Value of the `pm_pitcher_sess` browser cookie. Use only if you can't mint a token. |
| `PITCHMACHINE_API_BASE` | ❌ | `https://pitchmachine.ai` | Point at staging or a local dev server. |
| `PITCHMACHINE_REQUEST_TIMEOUT_MS` | ❌ | `30000` | Per-request HTTP timeout (ms). |

**Precedence:** if both `PITCHMACHINE_API_TOKEN` and
`PITCHMACHINE_SESSION_COOKIE` are set, the token wins. That lets you paste
the new token into your existing config without first deleting the old
cookie env var.

---

## Development

```bash
npm install
npm run build
npm test              # vitest, 100% mocked — 42 tests
npm run inspector     # open the MCP inspector against the built server
```

The unit tests are network-free. The client injects a fake `fetch`; tool
tests inject a stub client. That's what guards against regressions in the
code we own, but it does *not* prove the client talks to a real Pitch
Machine server correctly — that's what `scripts/smoke.mjs` is for. Every
release must pass both.

---

## Changelog

### v0.2.0 (this release)

- **Added:** `Authorization: Bearer` support as the recommended auth path.
  Set `PITCHMACHINE_API_TOKEN` to a token minted at Settings → Agent access
  (format: `pm_agent_live_<24 base62>`). Tokens are long-lived (no 14-day
  expiry), individually revocable, and named per-device so a leaked token
  can be nuked without affecting the others.
- **Docs:** install steps now lead with the token flow; cookie forwarding
  moved to an "Advanced / compatibility" section.
- **Docs:** env-var table reflects the new precedence (token beats cookie).
- **Added:** 6 more tests (42 total). Token-format handling, precedence,
  trim, and the friendly error message are pinned.
- **Unchanged:** everything else. The client, tool definitions, and wire
  shapes are byte-for-byte identical to `v0.1.1`. Cookie installs from
  `v0.1.x` keep working.

### v0.1.1 (2026-08-12)

- **Fixed:** receiver creation called `POST /api/v2/receivers`. The server
  exposes `POST /api/receivers` (no `/v2/`). Every first tool call in
  `v0.1.0` 404'd.
- **Fixed:** auth header. `v0.1.0` sent `Authorization: Bearer <supabase-jwt>`.
  The Pitch Machine server did not read that header — it authenticated
  via the `pm_pitcher_sess` HttpOnly cookie. `v0.1.1` forwarded the cookie
  value directly. Install steps updated.
- **Fixed:** `PITCHMACHINE_REQUEST_TIMEOUT_MS` was silently ignored (env
  parser wrote `requestTimeoutMs`, main read `timeoutMs`). Both fixed and
  a regression test pinned.
- **Added:** `PITCHMACHINE_SESSION_COOKIE` env var. `PITCHMACHINE_API_TOKEN`
  reserved for `v0.2.0`.
- **Added:** live smoke script at `scripts/smoke.mjs`. Run before
  trusting the install.
- **Added:** 11 more tests (36 total). Auth-header shape and env precedence
  pinned.

### v0.1.0 (2026-08-11) — do not use

Compiled, tested, published; did not actually work end-to-end because
of the two bugs above. Yanked from install docs. Kept on npm as a
version-history artifact.

---

## Roadmap

- **v0.2.0** (now): agent tokens + Bearer auth. Cookie fallback preserved.
- **v0.3** (next): one-click install — `.mcpb` bundle or Copy-config from
  Settings that assembles the JSON so the reader never types it by hand.
- **v0.5**: HTTP + SSE transport for hosted deployments.
- **v1.0**: `pitchmachine_send_pitch` — once platform email deliverability is
  ready. Follow along at [pitchmachine.ai/#/agents](https://pitchmachine.ai/#/agents).

---

## License

MIT © [Pitch Machine](https://pitchmachine.ai)
