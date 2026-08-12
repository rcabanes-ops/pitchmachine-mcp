// Thin, boring HTTP client around Pitch Machine's API.
//
// Everything the tools do goes through here. That means:
//   - one place to swap in the real Bearer/API-token scheme once
//     Pitch Machine ships /api/agent/token (v0.2.0)
//   - one place to standardize on error shapes
//   - one place to mock in tests (see test/client.test.ts)
//
// Auth today (v0.1.1): the client forwards a copied HttpOnly session cookie
// (`pm_pitcher_sess`) — the same cookie the browser holds after sign-in.
// This is honest but ugly: users copy the cookie value from DevTools. Once
// v0.2.0 lands a proper agent-token surface, `authHeaders()` gains a second
// branch and everything else stays the same.
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

/**
 * Auth modes supported by the client.
 *
 * - `session-cookie`: forward the browser's `pm_pitcher_sess` cookie value.
 *   The one that works against the current server. Ugly to acquire.
 * - `bearer`: forward `Authorization: Bearer <token>`. Reserved for v0.2.0
 *   when `/api/agent/token` ships. Currently unused in production.
 */
export type AuthMode = "session-cookie" | "bearer";

export interface ClientConfig {
  baseUrl: string;
  /**
   * The credential value. Semantics depend on `authMode`:
   *  - `session-cookie` → the cookie *value* (everything after `pm_pitcher_sess=`),
   *    URL-decoded if the browser encoded it.
   *  - `bearer` → the API token as issued by `/api/agent/token`.
   */
  token: string;
  authMode: AuthMode;
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

export class PitchMachineClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly authMode: AuthMode;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ClientConfig) {
    // Strip trailing slash so we can freely concatenate paths.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.authMode = config.authMode;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  // ---------------------------------------------------------------------------
  // Receivers
  // ---------------------------------------------------------------------------

  async createReceiver(input: CreateReceiverInput): Promise<ReceiverApiResponse> {
    // Translate MCP-facing snake_case to the server's canonical camelCase in
    // exactly one place. The server's createReceiverSchema is `.strict()`,
    // so we drop keys the caller didn't provide instead of forwarding
    // `undefined` (which JSON.stringify would elide anyway, but being
    // explicit makes the wire shape auditable in tests).
    //
    // Field-name source of truth: shared/schema.ts → `receiverFields`.
    // The web form at src/src/client/src/lib/receivers.ts posts the same
    // shape.
    //
    // Path note: the server exposes `/api/receivers` (not `/api/v2/…`).
    // Only the pitches endpoints are v2.
    const body: Record<string, unknown> = {
      companyName: input.company_name,
    };
    const set = (key: string, value: unknown): void => {
      if (value !== undefined) body[key] = value;
    };
    set("companyDomain", input.company_domain);
    set("companyIndustry", input.company_industry);
    set("companySize", input.company_size);
    set("companyLocation", input.company_location);
    set("personName", input.person_name);
    set("personTitle", input.person_title);
    set("personEmail", input.person_email);
    set("personLinkedin", input.person_linkedin);
    set("notes", input.notes);
    set("brandModeOverride", input.brand_mode_override);
    set("layoutIntentOverride", input.layout_intent_override);
    set("kineticEnabled", input.kinetic_enabled);
    set("kineticInAbout", input.kinetic_in_about);
    set("kineticAsSplash", input.kinetic_as_splash);
    set("audienceMode", input.audience_mode);
    set("lifeStage", input.life_stage);
    set("relationshipType", input.relationship_type);
    set("knownContext", input.known_context);
    set("linkedinPaste", input.linkedin_paste);

    const raw = await this.request("/api/receivers", {
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

  /**
   * Compose the auth header for a request.
   *
   * Kept as its own method so v0.2.0's Bearer-token path lands as a one-line
   * change (the `case "bearer"` branch is already here and unreachable today).
   */
  private authHeaders(): Record<string, string> {
    switch (this.authMode) {
      case "session-cookie":
        // The server reads `pm_pitcher_sess` from req.headers.cookie and only
        // from there — see server/lib/pitcher-session.ts:readSessionToken.
        // We pass the value URL-encoded because the browser stores it that
        // way and the server's parseCookies expects encoded values.
        return { Cookie: `pm_pitcher_sess=${encodeURIComponent(this.token)}` };
      case "bearer":
        return { Authorization: `Bearer ${this.token}` };
    }
  }

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
          ...this.authHeaders(),
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
