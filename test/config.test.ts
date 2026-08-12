// Env-config tests. These pin down the two-mode auth precedence rule
// (Bearer beats session-cookie) and the timeoutMs bug fix (v0.1.0 read the
// wrong field name, silently dropping PITCHMACHINE_REQUEST_TIMEOUT_MS).
//
// We call `readConfigFromEnv` directly with a synthetic env object so these
// tests don't mutate process.env — much easier to reason about in parallel
// vitest runs.

import { describe, expect, it } from "vitest";
import { readConfigFromEnv } from "../src/index.js";

describe("readConfigFromEnv", () => {
  it("defaults baseUrl to https://pitchmachine.ai when unset", () => {
    const cfg = readConfigFromEnv({ PITCHMACHINE_SESSION_COOKIE: "v2.abc" });
    expect(cfg.baseUrl).toBe("https://pitchmachine.ai");
  });

  it("honours PITCHMACHINE_API_BASE for dev/staging pointing", () => {
    const cfg = readConfigFromEnv({
      PITCHMACHINE_API_BASE: "http://localhost:5000",
      PITCHMACHINE_SESSION_COOKIE: "v2.abc",
    });
    expect(cfg.baseUrl).toBe("http://localhost:5000");
  });

  it("session-cookie env → session-cookie auth mode", () => {
    const cfg = readConfigFromEnv({ PITCHMACHINE_SESSION_COOKIE: "v2.abc.def.ghi.hmac" });
    expect(cfg.authMode).toBe("session-cookie");
    expect(cfg.token).toBe("v2.abc.def.ghi.hmac");
  });

  it("bearer env → bearer auth mode (v0.2.0 default path)", () => {
    const cfg = readConfigFromEnv({
      PITCHMACHINE_API_TOKEN: "pm_agent_live_abcdefghijkmnpqrstuvwxyz",
    });
    expect(cfg.authMode).toBe("bearer");
    expect(cfg.token).toBe("pm_agent_live_abcdefghijkmnpqrstuvwxyz");
  });

  it("accepts any non-empty string for the token (server validates format)", () => {
    // The client does not gate on the `pm_agent_live_` prefix. If the
    // server ever ships a second token class (e.g. pm_agent_test_ for
    // staging), this client keeps working without a code change.
    const cfg = readConfigFromEnv({ PITCHMACHINE_API_TOKEN: "pma_legacy_deadbeef" });
    expect(cfg.authMode).toBe("bearer");
    expect(cfg.token).toBe("pma_legacy_deadbeef");
  });

  it("bearer wins over session-cookie when both are set", () => {
    // Precedence matters: users mid-migration to v0.2.0 will keep the old
    // cookie env in their config and add the new token. New wins.
    const cfg = readConfigFromEnv({
      PITCHMACHINE_API_TOKEN: "pm_agent_live_new",
      PITCHMACHINE_SESSION_COOKIE: "v2.old",
    });
    expect(cfg.authMode).toBe("bearer");
    expect(cfg.token).toBe("pm_agent_live_new");
  });

  it("parses PITCHMACHINE_REQUEST_TIMEOUT_MS as a number (the v0.1.0 bug)", () => {
    // v0.1.0 returned this as `requestTimeoutMs` but read it as `timeoutMs`
    // in main() — silent typo. This test would have caught it.
    const cfg = readConfigFromEnv({
      PITCHMACHINE_SESSION_COOKIE: "v2.abc",
      PITCHMACHINE_REQUEST_TIMEOUT_MS: "45000",
    });
    expect(cfg.requestTimeoutMs).toBe(45000);
  });

  it("throws (rather than exits) when no credential is supplied and asked to throw", () => {
    // Production code calls process.exit(1); tests pass throwInsteadOfExit
    // to keep vitest alive. Error message must mention both env vars so
    // whichever install path the user is on, they see something familiar.
    expect(() =>
      readConfigFromEnv({}, { throwInsteadOfExit: true }),
    ).toThrow(/PITCHMACHINE_API_TOKEN.*PITCHMACHINE_SESSION_COOKIE/s);
  });

  it("error message points at Settings → Agent access as the recommended path", () => {
    // Regression guard for the friendly-install lead. v0.1.x pointed at
    // DevTools; v0.2.0 leads with the mint UI.
    try {
      readConfigFromEnv({}, { throwInsteadOfExit: true });
    } catch (err) {
      expect((err as Error).message).toMatch(/Agent access/);
      expect((err as Error).message).toMatch(/pm_agent_live_/);
      return;
    }
    throw new Error("expected readConfigFromEnv to throw");
  });

  it("trims whitespace from env values (paste-from-browser is messy)", () => {
    const cfg = readConfigFromEnv({
      PITCHMACHINE_SESSION_COOKIE: "   v2.abc.def.ghi.hmac   \n",
    });
    expect(cfg.token).toBe("v2.abc.def.ghi.hmac");
  });

  it("trims whitespace on bearer tokens too (Copy for Claude Desktop is trailing-newline-safe)", () => {
    // The Settings UI's copy-to-clipboard button drops a trailing newline
    // on some hosts. Never make the user notice.
    const cfg = readConfigFromEnv({
      PITCHMACHINE_API_TOKEN: "  pm_agent_live_deadbeef  \n",
    });
    expect(cfg.authMode).toBe("bearer");
    expect(cfg.token).toBe("pm_agent_live_deadbeef");
  });
});
