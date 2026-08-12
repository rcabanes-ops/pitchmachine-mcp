// Thin, boring HTTP client around Pitch Machine's v2 API.
//
// Everything the tools do goes through here. That means:
//   - one place to swap in a real Bearer/API-token scheme when Pitch Machine
//     ships one (today we forward a Supabase session JWT)
//   - one place to standardize on error shapes
//   - one place to mock in tests (see test/client.test.ts)
//
// Deliberately no retries. The generate-pitch tool has its own polling loop
// with a caller-controlled timeout; other tools are single-shot and the
// agent can decide whether to retry.

import {
  PitchApiResponseSchema,
  ReceiverApiResponseSchema,
  type CreateReceiverInput,
  type PitchApiResponse,
  type ReceiverApiResponse,
} from "./types.js";

export interface ClientConfig {
  baseUrl: string;
  token: string;
  requestTimeoutMs?: number;
  // Injected in tests. Node 20+ has global fetch.
  fetchImpl?: typeof fetch;
}

/**
 * Errors thrown from the client all wear this shape so tool handlers can
 * decide whether to surface them raw or repackage them for the agent.
 *
 * Notably: HTTP status is preserved so callers can special-case 402
 * (insufficient credits) or 401 (bad token) without regex-scraping the
 * message.
 */
export class PitchMachineApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(message: string, opts: { status: number; url: string; body: unknown }) {
    super(message);
    this.name = "PitchMachineApiError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

/**
 * Never throws. Returns `{ error }` for shape stability in tools that would
 * rather branch than catch. Reserved for the generate-pitch polling loop
 * where a single 404 during propagation isn't fatal.
 */
export interface SafeResult<T> {
  ok: true;
  value: T;
}
export interface SafeError {
  ok: false;
  error: PitchMachineApiError;
}
export type Safe<T> = SafeResult<T> | SafeError;

export class PitchMachineClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ClientConfig) {
    // Strip trailing slash so we can freely concatenate paths.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  // ---------------------------------------------------------------------------
  // Receivers
  // ---------------------------------------------------------------------------

  async createReceiver(input: CreateReceiverInput): Promise<ReceiverApiResponse> {
    // We deliberately forward the exact camelCase field names Pitch Machine's
    // /api/v2/receivers endpoint expects. The MCP-facing snake_case is
    // translated here — one place, one map — so if the API renames a field
    // the fix is local.
    const body: Record<string, unknown> = {
      audienceMode: input.audience_mode,
    };

    if (input.audience_mode === "b2b") {
      body.companyName = input.company_name;
      body.companyUrl = input.company_url;
      body.contactFirstName = input.contact_first_name;
      body.contactLastName = input.contact_last_name;
      body.contactTitle = input.contact_title;
      body.contactEmail = input.contact_email;
    } else {
      body.receiverFirstName = input.receiver_first_name;
      body.receiverLastName = input.receiver_last_name;
      body.receiverEmail = input.receiver_email;
      body.receiverNotes = input.receiver_notes;
    }
    if (input.custom_notes) body.customNotes = input.custom_notes;

    const raw = await this.request("/api/v2/receivers", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ReceiverApiResponseSchema.parse(raw);
  }

  // ---------------------------------------------------------------------------
  // Pitches
  // ---------------------------------------------------------------------------

  async prepayPitch(pitchId: string): Promise<void> {
    // Prepay is a side effect. Its response body isn't shaped as anything the
    // agent needs — the interesting signal is the HTTP status (200 = paid,
    // 402 = insufficient credits).
    await this.request(`/api/v2/pitches/${encodeURIComponent(pitchId)}/prepay`, {
      method: "POST",
      body: "{}",
    });
  }

  async createPitch(receiverId: string): Promise<PitchApiResponse> {
    const raw = await this.request("/api/v2/pitches", {
      method: "POST",
      body: JSON.stringify({ receiverId }),
    });
    return PitchApiResponseSchema.parse(raw);
  }

  async getPitch(pitchId: string): Promise<PitchApiResponse> {
    const raw = await this.request(`/api/v2/pitches/${encodeURIComponent(pitchId)}`, {
      method: "GET",
    });
    return PitchApiResponseSchema.parse(raw);
  }

  async listPitches(params: {
    limit?: number;
    status?: string;
    since?: string;
  } = {}): Promise<PitchApiResponse[]> {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.status) search.set("status", params.status);
    if (params.since) search.set("since", params.since);
    const query = search.toString();
    const path = `/api/v2/pitches${query ? `?${query}` : ""}`;
    const raw = await this.request(path, { method: "GET" });
    // Server may return an array or `{ pitches: [...] }`. Accept both so a
    // v2.1 pagination envelope doesn't break us.
    if (Array.isArray(raw)) {
      return raw.map((item) => PitchApiResponseSchema.parse(item));
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as { pitches?: unknown }).pitches)) {
      return (raw as { pitches: unknown[] }).pitches.map((item) => PitchApiResponseSchema.parse(item));
    }
    throw new PitchMachineApiError("Unexpected list-pitches response shape", {
      status: 200,
      url: path,
      body: raw,
    });
  }

  // ---------------------------------------------------------------------------
  // Low-level request
  // ---------------------------------------------------------------------------

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // Session JWT for v0. When Pitch Machine ships a real API-token
          // surface, only this line needs to change.
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new PitchMachineApiError(`Request timed out after ${this.requestTimeoutMs}ms`, {
          status: 0,
          url,
          body: null,
        });
      }
      throw new PitchMachineApiError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        { status: 0, url, body: null },
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Server returned non-JSON (rare — usually an HTML error page).
        // Preserve it so error messages surface the actual response.
        parsed = text;
      }
    }

    if (!response.ok) {
      const message = extractApiErrorMessage(parsed) ?? `HTTP ${response.status} ${response.statusText}`;
      throw new PitchMachineApiError(message, {
        status: response.status,
        url,
        body: parsed,
      });
    }

    return parsed;
  }
}

function extractApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  if (typeof rec.error === "string") return rec.error;
  if (typeof rec.message === "string") return rec.message;
  return null;
}
