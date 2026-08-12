# `@pitchmachine/mcp`

**Model Context Protocol server for [Pitch Machine](https://pitchmachine.ai).**
Build hyper-personalized pitch microsites from any AI agent — Claude Desktop,
Cursor, Grok Bot, Continue, or any other MCP host.

The agent creates the receiver, generates the microsite, and hands you back a
public URL. Sending is deliberately left to you (or to the agent, via its own
channels) — Pitch Machine gets out of the way after the artifact is ready.

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

## Install & configure

Grab your Pitch Machine access token. For now, this is a Supabase session
JWT — sign in at [pitchmachine.ai](https://pitchmachine.ai), open DevTools →
Application → Local Storage, find the `sb-<project>-auth-token` entry, and
copy the `access_token` string.

*(A proper API-token surface is coming. This is dogfood-quality auth for the
early access window. If that bothers you, please tell us.)*

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pitchmachine": {
      "command": "npx",
      "args": ["-y", "@pitchmachine/mcp"],
      "env": {
        "PITCHMACHINE_API_TOKEN": "eyJhbGciOi..."
      }
    }
  }
}
```

Restart Claude Desktop. The four tools appear in the tools panel.

### Cursor

`.cursor/mcp.json` at your repo root (or the global equivalent):

```json
{
  "mcpServers": {
    "pitchmachine": {
      "command": "npx",
      "args": ["-y", "@pitchmachine/mcp"],
      "env": {
        "PITCHMACHINE_API_TOKEN": "eyJhbGciOi..."
      }
    }
  }
}
```

### Grok Bot / any other MCP host

The stdio command is the same. Point your host at `npx -y @pitchmachine/mcp`
with `PITCHMACHINE_API_TOKEN` in the environment.

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
| `PITCHMACHINE_API_TOKEN` | ✅ | — | Supabase session JWT (v0 auth). |
| `PITCHMACHINE_API_BASE` | ❌ | `https://pitchmachine.ai` | Point at staging if needed. |
| `PITCHMACHINE_REQUEST_TIMEOUT_MS` | ❌ | `30000` | Per-request HTTP timeout. |

---

## Development

```bash
npm install
npm run build
npm test              # vitest, 100% mocked
npm run inspector     # open the MCP inspector against the built server
```

Tests are network-free. The client injects a fake `fetch`; tool tests
inject a stub client. If you want to smoke-test against a real Pitch
Machine account, build and point Claude Desktop / Cursor / the inspector
at the built binary.

---

## Roadmap

- **v0.1** (this release): four tools, stdio transport, session-JWT auth.
- **v0.5**: HTTP + SSE transport for hosted deployments; long-lived API tokens.
- **v1.0**: `pitchmachine_send_pitch` — once platform email deliverability is
  ready. Follow along at [pitchmachine.ai/#/agents](https://pitchmachine.ai/#/agents).

---

## License

MIT © [Pitch Machine](https://pitchmachine.ai)
