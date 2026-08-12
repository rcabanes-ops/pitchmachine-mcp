import type { PitchMachineClient } from "../client.js";
import {
  GetPitchUrlInputSchema,
  type GetPitchUrlInput,
  type GetPitchUrlOutput,
} from "../types.js";
import { derivePublicUrl } from "./_public-url.js";

export const GET_PITCH_URL_TOOL_NAME = "pitchmachine_get_pitch_url";

export const getPitchUrlToolDefinition = {
  name: GET_PITCH_URL_TOOL_NAME,
  description:
    "Fetch the current state and public share URL for a pitch by pitch_id. " +
    "Use this to resume after pitchmachine_generate_pitch timed out, to " +
    "re-share a URL later, or to check the status of any past pitch.",
  inputSchema: {
    type: "object",
    properties: {
      pitch_id: {
        type: "string",
        description: "The pitch_id returned by pitchmachine_generate_pitch or _list_pitches.",
      },
    },
    required: ["pitch_id"],
  },
} as const;

export async function handleGetPitchUrl(
  rawInput: unknown,
  client: PitchMachineClient,
): Promise<GetPitchUrlOutput> {
  const input: GetPitchUrlInput = GetPitchUrlInputSchema.parse(rawInput);
  const pitch = await client.getPitch(input.pitch_id);
  return {
    pitch_id: pitch.id,
    status: pitch.status,
    public_url: derivePublicUrl(pitch),
    receiver_id: pitch.receiverId ?? null,
    receiver_email: pitch.receiverEmail ?? null,
    generated_at: pitch.generatedAt ?? null,
  };
}
