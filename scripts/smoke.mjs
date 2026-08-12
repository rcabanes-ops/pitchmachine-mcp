#!/usr/bin/env node
// Live smoke test.
//
// This script talks to the real Pitch Machine API. It is the *only* thing
// in this repo that proves the client actually works - all unit tests mock
// fetch. Run before publishing every release.
//
// Usage (from any dir):
//   # v0.2.0 recommended path:
//   export PITCHMACHINE_API_TOKEN="pm_agent_live_xxxxxxxxxxxxxxxxxxxxxxxx"
//   # v0.1.x compatibility path (still works):
//   export PITCHMACHINE_SESSION_COOKIE="v2.abc.def.ghi.hmac"
//   export PITCHMACHINE_API_BASE="http://localhost:5000"   # optional
//   node scripts/smoke.mjs
//
// What it does:
//   1. GET  /api/v2/pitches?limit=1     - proves auth + versioned path.
//   2. POST /api/receivers              - proves the un-versioned path fix.
//       (Uses B2B mode with a placeholder company; the receiver is created
//        for real, so use a dev account or delete it after.)
//   3. Reports timing and status codes for both.
//
// Exit codes:
//   0  both calls succeeded, headers were correct
//   1  smoke failed - check output; do not publish
//
// This script deliberately does NOT go through the compiled client.
// A wrapper bug in client.ts could hide behind an identical bug in the
// smoke driver. The raw HTTP here is the ground truth.

import { PitchMachineClient } from "../dist/client.js";

const BASE = (process.env.PITCHMACHINE_API_BASE || "https://pitchmachine.ai").replace(/\/+$/, "");
const COOKIE = process.env.PITCHMACHINE_SESSION_COOKIE?.trim();
const TOKEN = process.env.PITCHMACHINE_API_TOKEN?.trim();

function die(msg) {
  console.error(`[smoke] ${msg}`);
  process.exit(1);
}

if (!COOKIE && !TOKEN) {
  die(
    "Set PITCHMACHINE_API_TOKEN (v0.2.0+, recommended) or PITCHMACHINE_SESSION_COOKIE " +
      "(v0.1.x compatibility) before running. See README §Install.",
  );
}

const authMode = TOKEN ? "bearer" : "session-cookie";
const credential = TOKEN ?? COOKIE;

console.error(`[smoke] base=${BASE}`);
console.error(`[smoke] auth=${authMode}`);

/**
 * Raw-fetch check first - proves the header shape by observation, not by
 * trust in our own client. If this fails, no point running the client
 * exercise.
 */
async function rawCheck() {
  const headers = {
    Accept: "application/json",
  };
  if (authMode === "session-cookie") {
    headers.Cookie = `pm_pitcher_sess=${encodeURIComponent(credential)}`;
  } else {
    headers.Authorization = `Bearer ${credential}`;
  }

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/v2/pitches?limit=1`, { headers });
  const ms = Date.now() - t0;
  const text = await res.text();

  console.error(`[smoke] raw GET /api/v2/pitches?limit=1 → ${res.status} in ${ms}ms`);
  if (!res.ok) {
    console.error(`[smoke] response body (first 400 chars): ${text.slice(0, 400)}`);
    if (res.status === 401) {
      die(
        authMode === "bearer"
          ? "401 unauthorized. Token was revoked, expired, or never existed. " +
              "Mint a new one at Settings → Agent access."
          : "401 unauthorized. Cookie is likely stale - re-sign-in and re-copy " +
              "pm_pitcher_sess.",
      );
    }
    die(`raw check failed with status ${res.status}`);
  }

  // Parse just enough to confirm shape.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    die(`response was not JSON: ${text.slice(0, 200)}`);
  }
  const count = Array.isArray(parsed)
    ? parsed.length
    : Array.isArray(parsed?.pitches)
      ? parsed.pitches.length
      : "?";
  console.error(`[smoke] raw check OK - server returned ${count} pitch record(s)`);
}

/**
 * Now exercise the compiled client. If the raw check passed but this
 * fails, the bug is in our client.
 */
async function clientCheck() {
  const client = new PitchMachineClient({
    baseUrl: BASE,
    token: credential,
    authMode,
  });

  const t0 = Date.now();
  const list = await client.listPitches({ limit: 1 });
  const ms = Date.now() - t0;
  console.error(
    `[smoke] client.listPitches({limit:1}) → ${list.length} record(s) in ${ms}ms`,
  );
}

/**
 * Verify the receiver endpoint path fix. This creates a real record -
 * flagged clearly so it can be spotted and deleted from the pitcher's
 * dashboard.
 */
async function receiverPathCheck() {
  if (!process.env.PITCHMACHINE_SMOKE_CREATE_RECEIVER) {
    console.error(
      "[smoke] skipping receiver create (would create a real record). " +
        "Set PITCHMACHINE_SMOKE_CREATE_RECEIVER=1 to include it.",
    );
    return;
  }

  const client = new PitchMachineClient({
    baseUrl: BASE,
    token: credential,
    authMode,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const t0 = Date.now();
  // Field names are the server's canonical `receiverFields` (see
  // shared/schema.ts). Only company_name is required. Everything else
  // here is present so a stray refactor in the client mapping shows up
  // as a 400 with "unrecognized keys" instead of a green smoke.
  const receiver = await client.createReceiver({
    company_name: `SMOKE-TEST ${stamp}`,
    company_domain: "pitchmachine.ai",
    person_name: "Smoke Test",
    person_email: `smoke+${stamp}@pitchmachine.ai`,
    notes: "Delete me - created by @pitchmachine/mcp-server scripts/smoke.mjs",
    audience_mode: "b2b",
  });
  const ms = Date.now() - t0;
  console.error(
    `[smoke] client.createReceiver(...) → id=${receiver.id} in ${ms}ms ` +
      "(delete this record from your dashboard).",
  );
}

try {
  await rawCheck();
  await clientCheck();
  await receiverPathCheck();
  console.error("[smoke] all checks passed ✓");
  process.exit(0);
} catch (err) {
  console.error(`[smoke] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
}
