#!/usr/bin/env node
// Pitch Machine MCP server.
//
// Registers four tools and speaks the Model Context Protocol over stdio.
// Meant to be launched by an MCP host (Claude Desktop, Cursor, Grok Bot,
// Continue, etc.) via `npx -y @pitchmachine/mcp`.
//
// If you're reading this because something broke: the server logs errors
// to stderr — stdout is reserved for the MCP protocol frames and must
// never be written to except by the SDK. Every `console.log` in this file
// is a bug.

import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { PitchMachineApiError, PitchMachineClient, type AuthMode } from "./client.js";
import {
  CREATE_RECEIVER_TOOL_NAME,
  createReceiverToolDefinition,
  handleCreateReceiver,
} from "./tools/create-receiver.js";
import {
  GENERATE_PITCH_TOOL_NAME,
  generatePitchToolDefinition,
  handleGeneratePitch,
} from "./tools/generate-pitch.js";
import {
  GET_PITCH_URL_TOOL_NAME,
  getPitchUrlToolDefinition,
  handleGetPitchUrl,
} from "./tools/get-pitch-url.js";
import {
  LIST_PITCHES_TOOL_NAME,
  handleListPitches,
  listPitchesToolDefinition,
} from "./tools/list-pitches.js";

const SERVER_NAME = "pitchmachine";
const SERVER_VERSION = "0.2.0";

function logStderr(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(`[pitchmachine-mcp] ${msg}`);
}

export interface ResolvedConfig {
  baseUrl: string;
  token: string;
  authMode: AuthMode;
  requestTimeoutMs?: number;
}

/**
 * Resolve config from env vars.
 *
 * Precedence:
 *   1. `PITCHMACHINE_API_TOKEN` present → Bearer mode (v0.2.0+, recommended).
 *      Token format: `pm_agent_live_<24 base62>` — minted in the app at
 *      Settings → Agent access.
 *   2. `PITCHMACHINE_SESSION_COOKIE` present → session-cookie mode (v0.1.x
 *      compatibility path; ok for one-off checks and pre-token accounts).
 *   3. Neither → fail loud on stderr and exit 1.
 *
 * Exported for tests. Never exits when `throwInsteadOfExit` is true.
 */
export function readConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: { throwInsteadOfExit?: boolean } = {},
): ResolvedConfig {
  const baseUrl = env.PITCHMACHINE_API_BASE?.trim() || "https://pitchmachine.ai";
  const bearerToken = env.PITCHMACHINE_API_TOKEN?.trim();
  const sessionCookie = env.PITCHMACHINE_SESSION_COOKIE?.trim();

  const timeoutRaw = env.PITCHMACHINE_REQUEST_TIMEOUT_MS?.trim();
  const requestTimeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined;

  if (bearerToken) {
    return { baseUrl, token: bearerToken, authMode: "bearer", requestTimeoutMs };
  }
  if (sessionCookie) {
    return { baseUrl, token: sessionCookie, authMode: "session-cookie", requestTimeoutMs };
  }

  const msg =
    "Neither PITCHMACHINE_API_TOKEN nor PITCHMACHINE_SESSION_COOKIE is set. " +
    "Recommended: sign in at https://pitchmachine.ai, go to Settings → " +
    "Agent access, mint a token (format: pm_agent_live_...), and set it as " +
    "PITCHMACHINE_API_TOKEN in your MCP host's env config. " +
    "Compatibility fallback: copy the pm_pitcher_sess cookie value from " +
    "DevTools and set it as PITCHMACHINE_SESSION_COOKIE. " +
    "See https://pitchmachine.ai/#/install for the full walkthrough.";
  if (opts.throwInsteadOfExit) throw new Error(msg);
  logStderr(msg);
  process.exit(1);
}

export async function main(): Promise<void> {
  const cfg = readConfigFromEnv();
  const client = new PitchMachineClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    authMode: cfg.authMode,
    requestTimeoutMs: cfg.requestTimeoutMs,
  });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      createReceiverToolDefinition,
      generatePitchToolDefinition,
      getPitchUrlToolDefinition,
      listPitchesToolDefinition,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await dispatch(name, args ?? {}, client);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatToolError(err),
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logStderr(
    `ready (server=${SERVER_NAME}@${SERVER_VERSION}, base=${cfg.baseUrl}, auth=${cfg.authMode})`,
  );
}

async function dispatch(name: string, args: unknown, client: PitchMachineClient): Promise<unknown> {
  switch (name) {
    case CREATE_RECEIVER_TOOL_NAME:
      return handleCreateReceiver(args, client);
    case GENERATE_PITCH_TOOL_NAME:
      return handleGeneratePitch(args, client);
    case GET_PITCH_URL_TOOL_NAME:
      return handleGetPitchUrl(args, client);
    case LIST_PITCHES_TOOL_NAME:
      return handleListPitches(args, client);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function formatToolError(err: unknown): string {
  if (err instanceof PitchMachineApiError) {
    return JSON.stringify(
      {
        error: err.message,
        status: err.status,
        url: err.url,
      },
      null,
      2,
    );
  }
  if (err instanceof Error) {
    return JSON.stringify({ error: err.message, name: err.name }, null, 2);
  }
  return JSON.stringify({ error: String(err) }, null, 2);
}

// Only run if invoked directly (not when imported by tests). Using
// pathToFileURL keeps this correct on Windows, where argv[1] is a
// backslash path and import.meta.url is a forward-slash file:// URL.
const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((err) => {
    logStderr(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}
