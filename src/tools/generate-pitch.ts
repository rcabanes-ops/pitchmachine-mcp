import { PitchMachineApiError, type PitchMachineClient } from "../client.js";
import {
  GeneratePitchInputSchema,
  type GeneratePitchInput,
  type GeneratePitchOutput,
  type PitchApiResponse,
} from "../types.js";
import { derivePublicUrl } from "./_public-url.js";

export const GENERATE_PITCH_TOOL_NAME = "pitchmachine_generate_pitch";

const DEFAULT_POLL_TIMEOUT_SECONDS = 90;
const POLL_INTERVAL_MS = 2_000;

// A pitch is "done" (in whatever direction) once it stops churning. These
// are the statuses we stop polling on. Anything else means "still working."
const TERMINAL_STATUSES = new Set(["deployed", "preview", "sent", "error", "cancelled"]);

export const generatePitchToolDefinition = {
  name: GENERATE_PITCH_TOOL_NAME,
  description:
    "Kick off pitch generation for an existing receiver and poll until it completes. " +
    "Returns the public share URL (pitchmachine.ai/p/<slug>?t=<token>) on success. " +
    "If generation takes longer than poll_timeout_seconds, returns the in-progress " +
    "status; call pitchmachine_get_pitch_url later with the returned pitch_id. " +
    "Does NOT send the pitch — that's the agent's job (or a human's).",
  inputSchema: {
    type: "object",
    properties: {
      receiver_id: {
        type: "string",
        description: "The receiver_id returned by pitchmachine_create_receiver.",
      },
      poll_timeout_seconds: {
        type: "number",
        minimum: 5,
        maximum: 180,
        description: `How long to wait for generation before returning in-progress. Default ${DEFAULT_POLL_TIMEOUT_SECONDS}.`,
      },
    },
    required: ["receiver_id"],
  },
} as const;

export async function handleGeneratePitch(
  rawInput: unknown,
  client: PitchMachineClient,
  clock: { now(): number; sleep(ms: number): Promise<void> } = defaultClock,
): Promise<GeneratePitchOutput> {
  const input: GeneratePitchInput = GeneratePitchInputSchema.parse(rawInput);
  const timeoutMs = (input.poll_timeout_seconds ?? DEFAULT_POLL_TIMEOUT_SECONDS) * 1000;

  // Step 1: create the pitch row. This does not yet consume a credit.
  const created = await client.createPitch(input.receiver_id);
  const pitchId = created.id;

  // Step 2: prepay. If the pitcher is out of credits, the API returns 402
  // and we surface an actionable message. We deliberately create the pitch
  // *before* prepaying so the pitch_id is real and the agent can retry
  // prepay-only later if the account gets topped up.
  try {
    await client.prepayPitch(pitchId);
  } catch (err) {
    if (err instanceof PitchMachineApiError && err.status === 402) {
      return {
        pitch_id: pitchId,
        status: "insufficient_credits",
        public_url: null,
        error:
          "Insufficient credits. Purchase credits at https://pitchmachine.ai and then call pitchmachine_get_pitch_url to resume.",
        generated_at: null,
      };
    }
    throw err;
  }

  // Step 3: poll until done or timeout.
  const started = clock.now();
  let latest: PitchApiResponse = created;
  while (!TERMINAL_STATUSES.has(latest.status)) {
    if (clock.now() - started >= timeoutMs) {
      return {
        pitch_id: pitchId,
        status: latest.status,
        public_url: derivePublicUrl(latest),
        error: null,
        generated_at: latest.generatedAt ?? null,
      };
    }
    await clock.sleep(POLL_INTERVAL_MS);
    latest = await client.getPitch(pitchId);
  }

  return {
    pitch_id: pitchId,
    status: latest.status,
    public_url: derivePublicUrl(latest),
    error: latest.status === "error" ? latest.error ?? "Generation failed." : null,
    generated_at: latest.generatedAt ?? null,
  };
}

const defaultClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};
