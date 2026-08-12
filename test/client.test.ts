// Client tests. We inject a fake `fetch` so we never touch the network.
//
// These tests cover the interface *we own* — request shape, header shape,
// error surfacing, response tolerance. They do NOT try to mirror every
// permutation Pitch Machine might return; those are the API's own tests.
// If the API drifts, tools.test.ts catches it because it uses the real
// derivation functions on live-shaped fixtures.

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
    it("sends camelCase B2B payload and returns tolerant response", async () => {
      const { fetch: fakeFetch, calls } = makeFakeFetch({
        status: 201,
        body: { id: "rcv_123", audienceMode: "b2b", createdAt: "2026-08-11T12:00:00Z" },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "tok_abc",
        fetchImpl: fakeFetch,
      });

      const result = await client.createReceiver({
        audience_mode: "b2b",
        company_name: "Acme",
        contact_email: "person@acme.com",
        custom_notes: "warm lead",
      });

      expect(result.id).toBe("rcv_123");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.example.com/api/v2/receivers");
      const parsed = JSON.parse(String(calls[0]?.init.body ?? "{}"));
      expect(parsed).toMatchObject({
        audienceMode: "b2b",
        companyName: "Acme",
        contactEmail: "person@acme.com",
        customNotes: "warm lead",
      });
      const headers = calls[0]?.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok_abc");
    });

    it("sends B2C fields when audience_mode is b2c", async () => {
      const { fetch: fakeFetch, calls } = makeFakeFetch({
        status: 201,
        body: { id: "rcv_c", audienceMode: "b2c", createdAt: "2026-08-11T12:00:00Z" },
      });
      const client = new PitchMachineClient({
        baseUrl: "https://api.example.com",
        token: "tok_abc",
        fetchImpl: fakeFetch,
      });

      await client.createReceiver({
        audience_mode: "b2c",
        receiver_first_name: "Ada",
        receiver_email: "ada@example.com",
      });

      const parsed = JSON.parse(String(calls[0]?.init.body ?? "{}"));
      expect(parsed).toMatchObject({
        audienceMode: "b2c",
        receiverFirstName: "Ada",
        receiverEmail: "ada@example.com",
      });
      // B2B fields should not leak into a B2C payload.
      expect(parsed).not.toHaveProperty("companyName");
      expect(parsed).not.toHaveProperty("contactEmail");
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
        fetchImpl: fakeFetch,
      });
      await client.listPitches();
      expect(calls[0]?.url).toBe("https://api.example.com/api/v2/pitches");
    });
  });
});
