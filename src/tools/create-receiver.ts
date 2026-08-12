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
    "Create a new receiver (a prospect or contact) in Pitch Machine. " +
    "audience_mode='b2b' requires company_name + contact_email. " +
    "audience_mode='b2c' requires receiver_email. " +
    "Returns receiver_id, used as the input to pitchmachine_generate_pitch.",
  inputSchema: {
    type: "object",
    properties: {
      audience_mode: {
        type: "string",
        enum: ["b2b", "b2c"],
        description: "Whether the receiver is a business contact (b2b) or an individual (b2c).",
      },
      company_name: { type: "string", description: "B2B: prospect company name." },
      company_url: { type: "string", description: "B2B: prospect company URL (used for brand research)." },
      contact_first_name: { type: "string" },
      contact_last_name: { type: "string" },
      contact_title: { type: "string", description: "B2B: contact's job title." },
      contact_email: { type: "string", description: "B2B: contact's email." },
      receiver_first_name: { type: "string" },
      receiver_last_name: { type: "string" },
      receiver_email: { type: "string", description: "B2C: receiver's email." },
      receiver_notes: { type: "string" },
      custom_notes: {
        type: "string",
        description: "Any freeform context the pitch generator should incorporate.",
      },
    },
    required: ["audience_mode"],
  },
} as const;

export async function handleCreateReceiver(
  rawInput: unknown,
  client: PitchMachineClient,
): Promise<CreateReceiverOutput> {
  const input: CreateReceiverInput = CreateReceiverInputSchema.parse(rawInput);
  const api = await client.createReceiver(input);
  return {
    receiver_id: api.id,
    audience_mode: (api.audienceMode as AudienceMode | undefined) ?? input.audience_mode,
    // The server should always return createdAt on a fresh create. If it
    // doesn't, we substitute now() rather than leave the field undefined —
    // agents building automations will use this timestamp for dedupe and a
    // missing field there is worse than a slightly optimistic one.
    created_at: api.createdAt ?? new Date().toISOString(),
  };
}
