// Client tests. We inject a fake `fetch` so we never touch the network.
//
// These tests cover the interface *we own* — request shape, header shape,
// error surfacing, response tolerance. They do NOT try to mirror every
// permutation Pitch Machine might return; those are the API's own tests.
// If the API drifts, tools.test.ts catches it because it uses the real
// derivation functions on live-shaped fixtures.
//
// Auth-mode note: v0.1.x defaults to `session-cookie` because the server
// only reads the `pm_pitcher_sess` cookie. `bearer` mode is exercised too
// because v0.2.0's /api/agent/token surface will flip the default and the
// header shape needs to already be right.

import { describe, expect, it } from "vitest";
import { PitchMachineApiError, PitchMachineClient } from "../src/client.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function makeFakeFetch(response: {
  status?: number;
  body?: unknown;
  bodyText?: string;
  throwsWith?: string;
}): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    if (response.throwsWith) {
      throw new Error(response.throwsWith);
    }
    const status = response.status ?? 200;
    const bodyText =
      response.bodyText ?? (response.body === undefined ? "" : JSON.stringify(response.body));
    return new Response(bodyText, { status });
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

describe("PitchMachineClient", () => {
  describe("createReceiver", () => {
    // Ground truth for these tests is `shared/schema.ts` → `receiverFields`
    // and `createReceiverSchema` on the marketing repo. That schema is
    // `.strict()` so any typo here would 400 in production; every field
    // asserted below is a real column the server accepts.
    it("POSTs to /api/receivers (not /api/v2/…) with canonical camelCase fields", async () => {
      // The receivers endpoint is deliberately un-versioned — see
      // server/routes.ts:968. Regressing to /api/v2/receivers 404s every
      // first tool call.
      const { fetch: fakeFetch, calls } = makeFakeFetch({
        status: 201,
        body: { id: "rcv_123", audienceMode: "b2b", createdAt: "2026-08-11T12:00:00Z" },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "cookie_value",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      const result = await client.createReceiver({
        company_name: "Acme",
        company_domain: "acme.com",
        person_name: "Ada Lovelace",
        person_title: "CTO",
        person_email: "ada@acme.com",
        notes: "warm lead",
        audience_mode: "b2b",
      });

      expect(result.id).toBe("rcv_123");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.example.com/api/receivers");
      const parsed = JSON.parse(String(calls[0]?.init.body ?? "{}"));
      expect(parsed).toEqual({
        companyName: "Acme",
        companyDomain: "acme.com",
        personName: "Ada Lovelace",
        personTitle: "CTO",
        personEmail: "ada@acme.com",
        notes: "warm lead",
        audienceMode: "b2b",
      });
    });

    it("only sends companyName when nothing else is supplied", async () => {
      // The server's strict schema will happily accept `{ companyName }` and
      // default every other field. This guards against a future refactor
      // that starts padding the wire body with empty strings the server
      // doesn't want.
      const { fetch: fakeFetch, calls } = makeFakeFetch({
        status: 201,
        body: { id: "rcv_bare", createdAt: "2026-08-11T12:00:00Z" },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "c",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await client.createReceiver({ company_name: "Solo Inc" });

      const parsed = JSON.parse(String(calls[0]?.init.body ?? "{}"));
      expect(parsed).toEqual({ companyName: "Solo Inc" });
    });

    it("forwards B2C-specific fields and audienceMode when set", async () => {
      // B2C intake is not a separate payload — it's the same shape with
      // audience_mode: 'b2c' and the four B2C-only strings filled in.
      const { fetch: fakeFetch, calls } = makeFakeFetch({
        status: 201,
        body: { id: "rcv_c", audienceMode: "b2c", createdAt: "2026-08-11T12:00:00Z" },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "cookie_value",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await client.createReceiver({
        company_name: "Personal Book",
        person_name: "Ada Lovelace",
        person_email: "ada@example.com",
        audience_mode: "b2c",
        life_stage: "job search",
        relationship_type: "former colleague",
        known_context: "met at OSCON 2019",
        linkedin_paste: "Ada Lovelace — Head of Platform …",
      });

      const parsed = JSON.parse(String(calls[0]?.init.body ?? "{}"));
      expect(parsed).toEqual({
        companyName: "Personal Book",
        personName: "Ada Lovelace",
        personEmail: "ada@example.com",
        audienceMode: "b2c",
        lifeStage: "job search",
        relationshipType: "former colleague",
        knownContext: "met at OSCON 2019",
        linkedinPaste: "Ada Lovelace — Head of Platform …",
      });
      // The fabricated B2B/B2C split from v0.1.0 must never come back.
      expect(parsed).not.toHaveProperty("contactEmail");
      expect(parsed).not.toHaveProperty("contactFirstName");
      expect(parsed).not.toHaveProperty("receiverEmail");
      expect(parsed).not.toHaveProperty("receiverFirstName");
      expect(parsed).not.toHaveProperty("companyUrl");
      expect(parsed).not.toHaveProperty("customNotes");
    });

    it("forwards nullable overrides as explicit null (not omitted)", async () => {
      // The server treats `key: null` and `key: absent` differently on
      // update; on create it's mostly cosmetic but we still preserve the
      // caller's intent.
      const { fetch: fakeFetch, calls } = makeFakeFetch({
        status: 201,
        body: { id: "rcv_x", createdAt: "2026-08-11T12:00:00Z" },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "c",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await client.createReceiver({
        company_name: "Acme",
        brand_mode_override: null,
        layout_intent_override: null,
        audience_mode: null,
      });

      const parsed = JSON.parse(String(calls[0]?.init.body ?? "{}"));
      expect(parsed.brandModeOverride).toBeNull();
      expect(parsed.layoutIntentOverride).toBeNull();
      expect(parsed.audienceMode).toBeNull();
    });
  });

  describe("auth headers", () => {
    it("session-cookie mode sends a Cookie header with pm_pitcher_sess", async () => {
      // This is the header the server actually reads. It matches
      // server/lib/pitcher-session.ts:readSessionToken byte-for-byte.
      const { fetch: fakeFetch, calls } = makeFakeFetch({ status: 200, body: [] });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "v2.abc.123.jti.hmac",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await client.listPitches();

      const headers = calls[0]?.init.headers as Record<string, string>;
      expect(headers.Cookie).toBe("pm_pitcher_sess=v2.abc.123.jti.hmac");
      // Belt-and-braces: no Authorization header in session-cookie mode.
      expect(headers.Authorization).toBeUndefined();
    });

    it("URL-encodes cookie values so `+` and `=` survive the wire", async () => {
      const { fetch: fakeFetch, calls } = makeFakeFetch({ status: 200, body: [] });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "v2.abc.123.jti+with/slashes=pad",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await client.listPitches();

      const headers = calls[0]?.init.headers as Record<string, string>;
      // The server's parseCookies calls decodeURIComponent, so we encode.
      expect(headers.Cookie).toBe(
        "pm_pitcher_sess=v2.abc.123.jti%2Bwith%2Fslashes%3Dpad",
      );
    });

    it("bearer mode sends Authorization: Bearer and no Cookie", async () => {
      // v0.2.0 will flip the default to this once /api/agent/token ships.
      const { fetch: fakeFetch, calls } = makeFakeFetch({ status: 200, body: [] });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "pma_deadbeef",
        authMode: "bearer",
        fetchImpl: fakeFetch,
      });

      await client.listPitches();

      const headers = calls[0]?.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer pma_deadbeef");
      expect(headers.Cookie).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws PitchMachineApiError with API-supplied message on non-2xx", async () => {
      const { fetch: fakeFetch } = makeFakeFetch({
        status: 402,
        body: { error: "Insufficient credits" },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "t",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await expect(client.prepayPitch("p_1")).rejects.toMatchObject({
        name: "PitchMachineApiError",
        status: 402,
        message: "Insufficient credits",
      });
    });

    it("falls back to statusText when server returns no JSON error body", async () => {
      const { fetch: fakeFetch } = makeFakeFetch({
        status: 500,
        bodyText: "Internal Server Error",
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "t",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      // Use listPitches — a GET so no body shape to worry about.
      await expect(client.listPitches()).rejects.toBeInstanceOf(PitchMachineApiError);
    });

    it("wraps network failures", async () => {
      const { fetch: fakeFetch } = makeFakeFetch({ throwsWith: "ECONNREFUSED" });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "t",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await expect(client.listPitches()).rejects.toMatchObject({
        name: "PitchMachineApiError",
        status: 0,
      });
    });
  });

  describe("listPitches", () => {
    it("accepts an array response", async () => {
      const { fetch: fakeFetch } = makeFakeFetch({
        status: 200,
        body: [
          { id: "p_1", status: "deployed" },
          { id: "p_2", status: "generating" },
        ],
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "t",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      const pitches = await client.listPitches({ limit: 10 });
      expect(pitches).toHaveLength(2);
      expect(pitches[0]?.id).toBe("p_1");
    });

    it("accepts a { pitches: [...] } envelope", async () => {
      const { fetch: fakeFetch } = makeFakeFetch({
        status: 200,
        body: { pitches: [{ id: "p_1", status: "deployed" }], nextPageToken: null },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "t",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      const pitches = await client.listPitches();
      expect(pitches).toHaveLength(1);
      expect(pitches[0]?.id).toBe("p_1");
    });

    it("passes query params for limit/status/since", async () => {
      const { fetch: fakeFetch, calls } = makeFakeFetch({ status: 200, body: [] });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "t",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });

      await client.listPitches({ limit: 25, status: "deployed", since: "2026-01-01T00:00:00Z" });
      const url = calls[0]?.url ?? "";
      expect(url).toContain("limit=25");
      expect(url).toContain("status=deployed");
      expect(url).toContain("since=2026-01-01T00%3A00%3A00Z");
    });
  });

  describe("baseUrl handling", () => {
    it("strips trailing slashes so paths concatenate cleanly", async () => {
      const { fetch: fakeFetch, calls } = makeFakeFetch({ status: 200, body: [] });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com///",
        token: "t",
        authMode: "session-cookie",
        fetchImpl: fakeFetch,
      });
      await client.listPitches();
      expect(calls[0]?.url).toBe("https://api.example.com/api/v2/pitches");
    });
  });
});
