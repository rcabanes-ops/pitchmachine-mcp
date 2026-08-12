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

  it("bearer env → bearer auth mode (reserved for v0.2.0)", () => {
    const cfg = readConfigFromEnv({ PITCHMACHINE_API_TOKEN: "pma_deadbeef" });
    expect(cfg.authMode).toBe("bearer");
    expect(cfg.token).toBe("pma_deadbeef");
  });

  it("bearer wins over session-cookie when both are set", () => {
    // Precedence matters: users mid-migration to v0.2.0 will keep the old
    // cookie env in their config and add the new token. New wins.
    const cfg = readConfigFromEnv({
      PITCHMACHINE_API_TOKEN: "pma_new",
      PITCHMACHINE_SESSION_COOKIE: "v2.old",
    });
    expect(cfg.authMode).toBe("bearer");
    expect(cfg.token).toBe("pma_new");
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
    // to keep vitest alive.
    expect(() =>
      readConfigFromEnv({}, { throwInsteadOfExit: true }),
    ).toThrow(/PITCHMACHINE_SESSION_COOKIE/);
  });

  it("trims whitespace from env values (paste-from-browser is messy)", () => {
    const cfg = readConfigFromEnv({
      PITCHMACHINE_SESSION_COOKIE: "   v2.abc.def.ghi.hmac   \n",
    });
    expect(cfg.token).toBe("v2.abc.def.ghi.hmac");
  });
});
