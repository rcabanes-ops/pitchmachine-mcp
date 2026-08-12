// Contracts we speak to Pitch Machine v2.
//
// These are *tolerant* schemas — the server is the source of truth and we
// deliberately keep fields optional where the server has evolved and might
// evolve again. The MCP-facing shapes (what we return to the calling agent)
// are the strict ones; those live at the bottom of this file.
//
// If a Pitch Machine response drifts (a new status, a renamed field), the
// tolerant layer here should keep the tool alive with graceful degradation,
// and a test in `test/client.test.ts` should start failing so we notice.
//
// v0.1.1 note (receivers): the create-receiver input mirrors the server's
// canonical `createReceiverSchema` in `shared/schema.ts` — same field
// names, exposed to agents in snake_case and mapped 1:1 in the client.
// A previous draft invented a `contact_*` / `receiver_*` split that does
// not exist on the server; the server's `.strict()` schema rejected every
// call. The current shape is the same one the production web form posts.

import { z } from "zod";

// -----------------------------------------------------------------------------
// Common
// -----------------------------------------------------------------------------

/**
 * Audience mode as the server understands it. `mixed` is legal server-side
 * but is a pitcher-level property in practice; we accept it because a caller
 * that wants to stamp a receiver in a mixed pitcher's book should be able to.
 * Null means "inherit the pitcher default", which the server also accepts.
 */
export const AudienceModeSchema = z.enum(["b2b", "b2c", "mixed"]);
export type AudienceMode = z.infer<typeof AudienceModeSchema>;

// The set of statuses Pitch Machine emits today. We keep this as a union
// but the client layer accepts *any* string so a new status doesn't break us.
export const KnownPitchStatuses = [
  "draft",
  "generating",
  "preview",
  "deployed",
  "sent",
  "error",
  "cancelled",
] as const;

export type KnownPitchStatus = (typeof KnownPitchStatuses)[number];

// -----------------------------------------------------------------------------
// Receivers
// -----------------------------------------------------------------------------

/**
 * MCP-facing input shape for creating a receiver.
 *
 * These field names are the canonical server shape (`shared/schema.ts` →
 * `receiverFields`) re-exposed to agents in snake_case. The client translates
 * to camelCase in exactly one place (`PitchMachineClient.createReceiver`).
 *
 * Only `company_name` is required — the server's `createReceiverSchema` is
 * `.strict().partial(...)` with `companyName` explicitly `min(1)`. Every
 * other field is optional; empty strings are legal for the string-typed
 * ones and are how the production form clears a value.
 *
 * B2C intake is *not* a separate payload — it is the same shape with
 * `audience_mode: "b2c"` and the four B2C-only strings filled in
 * (`life_stage`, `relationship_type`, `known_context`, `linkedin_paste`).
 * There is one contact per receiver in both modes.
 */
export const CreateReceiverInputSchema = z
  .object({
    // Required.
    company_name: z.string().min(1),

    // Company (optional, all default to "" server-side).
    company_domain: z.string().optional(),
    company_industry: z.string().optional(),
    company_size: z.string().optional(),
    company_location: z.string().optional(),

    // The one contact human (optional; the send path is what refuses to
    // mail an unaddressed receiver, not the create path).
    person_name: z.string().optional(),
    person_title: z.string().optional(),
    // Server rule: empty string OK, otherwise must look like an email.
    // We keep the loose check here so the error surfaces client-side with
    // a useful message before we hit the wire.
    person_email: z
      .string()
      .refine((v) => v === "" || /.+@.+\..+/.test(v), {
        message: "person_email must be an email address or empty string",
      })
      .optional(),
    person_linkedin: z.string().optional(),

    // Free-form pitcher-side notes (B2B canonical field).
    notes: z.string().optional(),

    // Per-receiver overrides. Nullable — null clears the override and
    // lets the receiver inherit the pitcher's default.
    brand_mode_override: z
      .enum(["receiver_mirror", "pitcher_own"])
      .nullable()
      .optional(),
    layout_intent_override: z
      .enum(["editorial", "balanced", "technical"])
      .nullable()
      .optional(),

    // Kinetic-typography motion intro. When kinetic_enabled is true the
    // server route also requires at least one of the placement flags —
    // we mirror the server's laxness at the schema level and let the
    // route surface the specific error if a caller violates the rule.
    kinetic_enabled: z.boolean().optional(),
    kinetic_in_about: z.boolean().optional(),
    kinetic_as_splash: z.boolean().optional(),

    // Audience stamp. Null means "inherit the pitcher's default" and reads
    // as b2b at every non-mode-aware call site server-side.
    audience_mode: AudienceModeSchema.nullable().optional(),

    // B2C-only strings. Empty string for B2B (which is what the server
    // form does). Callers can just leave them out — the client won't
    // send them and the server will default them.
    life_stage: z.string().optional(),
    relationship_type: z.string().optional(),
    known_context: z.string().optional(),
    linkedin_paste: z.string().optional(),
  })
  .strict();

export type CreateReceiverInput = z.infer<typeof CreateReceiverInputSchema>;

// What the API returns. Tolerant — we accept anything with an id.
export const ReceiverApiResponseSchema = z
  .object({
    id: z.string(),
    audienceMode: z.string().nullable().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

export type ReceiverApiResponse = z.infer<typeof ReceiverApiResponseSchema>;

// What we return to the agent. Strict.
export interface CreateReceiverOutput {
  receiver_id: string;
  audience_mode: AudienceMode | null;
  created_at: string;
}

// -----------------------------------------------------------------------------
// Pitches
// -----------------------------------------------------------------------------

export const PitchApiResponseSchema = z
  .object({
    id: z.string(),
    receiverId: z.string().optional(),
    status: z.string(),
    slug: z.string().nullable().optional(),
    shareToken: z.string().nullable().optional(),
    publicUrl: z.string().nullable().optional(),
    deployUrl: z.string().nullable().optional(),
    receiverEmail: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    generatedAt: z.string().nullable().optional(),
    emailSentAt: z.string().nullable().optional(),
    finalScore: z.number().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .passthrough();

export type PitchApiResponse = z.infer<typeof PitchApiResponseSchema>;

export const GeneratePitchInputSchema = z.object({
  receiver_id: z.string().min(1),
  poll_timeout_seconds: z.number().int().min(5).max(180).optional(),
});
export type GeneratePitchInput = z.infer<typeof GeneratePitchInputSchema>;

export interface GeneratePitchOutput {
  pitch_id: string;
  status: string;
  public_url: string | null;
  error: string | null;
  generated_at: string | null;
}

export const GetPitchUrlInputSchema = z.object({
  pitch_id: z.string().min(1),
});
export type GetPitchUrlInput = z.infer<typeof GetPitchUrlInputSchema>;

export interface GetPitchUrlOutput {
  pitch_id: string;
  status: string;
  public_url: string | null;
  receiver_id: string | null;
  receiver_email: string | null;
  generated_at: string | null;
}

export const ListPitchesInputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  status_filter: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
});
export type ListPitchesInput = z.infer<typeof ListPitchesInputSchema>;

export interface ListPitchesOutputPitch {
  pitch_id: string;
  receiver_id: string | null;
  receiver_email: string | null;
  status: string;
  public_url: string | null;
  created_at: string | null;
}

export interface ListPitchesOutput {
  pitches: ListPitchesOutputPitch[];
  total_returned: number;
}
