import type { PitchMachineClient } from "../client.js";
import {
  CreateReceiverInputSchema,
  type AudienceMode,
  type CreateReceiverInput,
  type CreateReceiverOutput,
} from "../types.js";

export const CREATE_RECEIVER_TOOL_NAME = "pitchmachine_create_receiver";

export const createReceiverToolDefinition = {
  name: CREATE_RECEIVER_TOOL_NAME,
  description:
    "Create a receiver (a prospect + one contact human) in Pitch Machine. " +
    "Only `company_name` is required. B2B receivers set audience_mode='b2b' " +
    "(or leave it unset — the server treats null as b2b). B2C receivers set " +
    "audience_mode='b2c' and fill life_stage / relationship_type / known_context / " +
    "linkedin_paste as free-text if relevant. There is one contact per receiver " +
    "in both modes (person_name, person_title, person_email, person_linkedin). " +
    "Returns receiver_id, used as the input to pitchmachine_generate_pitch.",
  inputSchema: {
    type: "object",
    properties: {
      // Required.
      company_name: {
        type: "string",
        description:
          "Prospect organization name. For B2C this is still the company/context " +
          "the receiver is associated with (e.g. their employer, or the household " +
          "label the pitcher uses to identify them). Required.",
      },

      // Company.
      company_domain: {
        type: "string",
        description:
          "Bare domain, e.g. 'acme.com'. Used by the brand-extract and research pipelines.",
      },
      company_industry: { type: "string" },
      company_size: { type: "string", description: "Free-text label such as '50-200' or 'SMB'." },
      company_location: { type: "string", description: "Free-text location, e.g. 'San Francisco, CA'." },

      // The one contact.
      person_name: { type: "string", description: "Full name of the contact human." },
      person_title: { type: "string" },
      person_email: {
        type: "string",
        description:
          "Empty string is legal — the receiver can be addressed later. Any non-empty " +
          "value must look like an email address.",
      },
      person_linkedin: { type: "string", description: "LinkedIn profile URL." },

      // Notes + overrides.
      notes: {
        type: "string",
        description:
          "Pitcher-side free-text notes about this receiver. Free-form context the " +
          "pitch generator should incorporate.",
      },
      brand_mode_override: {
        type: ["string", "null"],
        enum: ["receiver_mirror", "pitcher_own", null],
        description:
          "Per-receiver brand-mode override. null clears the override so this receiver " +
          "inherits the pitcher's default.",
      },
      layout_intent_override: {
        type: ["string", "null"],
        enum: ["editorial", "balanced", "technical", null],
        description:
          "Per-receiver layout-intent override. null clears the override.",
      },
      kinetic_enabled: { type: "boolean" },
      kinetic_in_about: { type: "boolean" },
      kinetic_as_splash: { type: "boolean" },

      // Audience stamp + B2C-only strings.
      audience_mode: {
        type: ["string", "null"],
        enum: ["b2b", "b2c", "mixed", null],
        description:
          "Audience stamp for this receiver. null means 'inherit the pitcher default' " +
          "and reads as b2b at every non-mode-aware call site.",
      },
      life_stage: {
        type: "string",
        description: "B2C free-text, e.g. 'expecting first child'. Empty string for B2B.",
      },
      relationship_type: {
        type: "string",
        description: "B2C free-text, e.g. 'former colleague'. Empty string for B2B.",
      },
      known_context: {
        type: "string",
        description: "B2C free-text notes. Empty string for B2B.",
      },
      linkedin_paste: {
        type: "string",
        description: "B2C: raw paste from LinkedIn (LinkedIn blocks scraping). Empty string for B2B.",
      },
    },
    required: ["company_name"],
    additionalProperties: false,
  },
} as const;

export async function handleCreateReceiver(
  rawInput: unknown,
  client: PitchMachineClient,
): Promise<CreateReceiverOutput> {
  const input: CreateReceiverInput = CreateReceiverInputSchema.parse(rawInput);
  const api = await client.createReceiver(input);
  const stampedMode = (api.audienceMode ?? input.audience_mode ?? null) as
    | AudienceMode
    | null;
  return {
    receiver_id: api.id,
    audience_mode: stampedMode,
    // The server should always return createdAt on a fresh create. If it
    // doesn't, we substitute now() rather than leave the field undefined —
    // agents building automations will use this timestamp for dedupe and a
    // missing field there is worse than a slightly optimistic one.
    created_at: api.createdAt ?? new Date().toISOString(),
  };
}
