// Contracts we speak to Pitch Machine v2.
//
// These are *tolerant* schemas — the server is the source of truth and we
// deliberately keep fields optional where the server has evolved and might
// evolve again. The MCP-facing shapes (what we return to the calling agent)
// are the strict ones; those live at the bottom of this file.
//
// If a Pitch Machine response drifts (a new status, a renamed field), the
// tolerant layer here should keep the tool alive with graceful degradation,
// and a test in `test/tools.test.ts` should start failing so we notice.

import { z } from "zod";

// -----------------------------------------------------------------------------
// Common
// -----------------------------------------------------------------------------

export const AudienceModeSchema = z.enum(["b2b", "b2c"]);
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

export const CreateReceiverInputSchema = z
  .object({
    audience_mode: AudienceModeSchema,
    // B2B fields
    company_name: z.string().min(1).optional(),
    company_url: z.string().url().optional(),
    contact_first_name: z.string().min(1).optional(),
    contact_last_name: z.string().min(1).optional(),
    contact_title: z.string().min(1).optional(),
    contact_email: z.string().email().optional(),
    // B2C fields
    receiver_first_name: z.string().min(1).optional(),
    receiver_last_name: z.string().min(1).optional(),
    receiver_email: z.string().email().optional(),
    receiver_notes: z.string().optional(),
    // Common
    custom_notes: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // Cross-field validation: audience_mode dictates which fields are required.
    // We do this here rather than at the field level so the error message
    // points the agent at the right correction ("provide company_name for
    // b2b" is more useful than "company_name is required").
    if (val.audience_mode === "b2b") {
      if (!val.company_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["company_name"],
          message: "company_name is required when audience_mode is b2b",
        });
      }
      if (!val.contact_email) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contact_email"],
          message: "contact_email is required when audience_mode is b2b",
        });
      }
    } else {
      if (!val.receiver_email) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["receiver_email"],
          message: "receiver_email is required when audience_mode is b2c",
        });
      }
    }
  });

export type CreateReceiverInput = z.infer<typeof CreateReceiverInputSchema>;

// What the API returns. Tolerant — we accept anything with an id.
export const ReceiverApiResponseSchema = z
  .object({
    id: z.string(),
    audienceMode: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

export type ReceiverApiResponse = z.infer<typeof ReceiverApiResponseSchema>;

// What we return to the agent. Strict.
export interface CreateReceiverOutput {
  receiver_id: string;
  audience_mode: AudienceMode;
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
