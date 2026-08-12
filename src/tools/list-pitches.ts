import type { PitchMachineClient } from "../client.js";
import {
  ListPitchesInputSchema,
  type ListPitchesInput,
  type ListPitchesOutput,
} from "../types.js";
import { derivePublicUrl } from "./_public-url.js";

export const LIST_PITCHES_TOOL_NAME = "pitchmachine_list_pitches";

const DEFAULT_LIMIT = 50;

export const listPitchesToolDefinition = {
  name: LIST_PITCHES_TOOL_NAME,
  description:
    "List recent pitches for the authenticated Pitch Machine account. " +
    "Use this to discover pitch_ids for pitches created outside this agent " +
    "session, or to audit what an agent has already generated. Optional " +
    "filters: status_filter, since (ISO timestamp), limit.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        minimum: 1,
        maximum: 200,
        description: `How many pitches to return. Default ${DEFAULT_LIMIT}.`,
      },
      status_filter: {
        type: "string",
        description:
          "Optional status filter, e.g. 'deployed', 'generating', 'sent', 'error'.",
      },
      since: {
        type: "string",
        description: "Only return pitches created after this ISO-8601 timestamp.",
      },
    },
  },
} as const;

export async function handleListPitches(
  rawInput: unknown,
  client: PitchMachineClient,
): Promise<ListPitchesOutput> {
  const input: ListPitchesInput = ListPitchesInputSchema.parse(rawInput ?? {});
  const pitches = await client.listPitches({
    limit: input.limit ?? DEFAULT_LIMIT,
    status: input.status_filter,
    since: input.since,
  });
  const mapped = pitches.map((pitch) => ({
    pitch_id: pitch.id,
    receiver_id: pitch.receiverId ?? null,
    receiver_email: pitch.receiverEmail ?? null,
    status: pitch.status,
    public_url: derivePublicUrl(pitch),
    created_at: pitch.createdAt ?? null,
  }));
  return {
    pitches: mapped,
    total_returned: mapped.length,
  };
}
