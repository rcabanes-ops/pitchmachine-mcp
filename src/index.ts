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

import { PitchMachineApiError, PitchMachineClient } from "./client.js";
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
const SERVER_VERSION = "0.1.0";

function logStderr(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(`[pitchmachine-mcp] ${msg}`);
}

function readConfigFromEnv(): { baseUrl: string; token: string; timeoutMs?: number } {
  const baseUrl = process.env.PITCHMACHINE_API_BASE?.trim() || "https://pitchmachine.ai";
  const token = process.env.PITCHMACHINE_API_TOKEN?.trim();
  if (!token) {
    logStderr(
      "PITCHMACHINE_API_TOKEN is not set. Add it to your MCP host's env config. " +
        "See https://pitchmachine.ai/#/agents for setup instructions.",
    );
    process.exit(1);
  }
  const timeoutRaw = process.env.PITCHMACHINE_REQUEST_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined;
  return { baseUrl, token, requestTimeoutMs: timeoutMs } as { baseUrl: string; token: string; timeoutMs?: number };
}

export async function main(): Promise<void> {
  const cfg = readConfigFromEnv();
  const client = new PitchMachineClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    requestTimeoutMs: cfg.timeoutMs,
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
  logStderr(`ready (server=${SERVER_NAME}@${SERVER_VERSION}, base=${cfg.baseUrl})`);
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
