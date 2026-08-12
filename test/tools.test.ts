// Tool-handler tests. Each tool is exercised against a stub client so we
// isolate the *tool's* contract from the wire client's contract.
//
// These tests are the fastest place to notice contract drift: they assert
// the shape the AGENT sees, so if you change a field name, one of these
// fails immediately.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PitchMachineApiError, type PitchMachineClient } from "../src/client.js";
import { handleCreateReceiver } from "../src/tools/create-receiver.js";
import { handleGeneratePitch } from "../src/tools/generate-pitch.js";
import { handleGetPitchUrl } from "../src/tools/get-pitch-url.js";
import { handleListPitches } from "../src/tools/list-pitches.js";
import { derivePublicUrl } from "../src/tools/_public-url.js";

function makeStubClient(overrides: Partial<PitchMachineClient> = {}): PitchMachineClient {
  const base = {
    createReceiver: vi.fn(),
    createPitch: vi.fn(),
    prepayPitch: vi.fn(),
    getPitch: vi.fn(),
    listPitches: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as PitchMachineClient;
}

describe("pitchmachine_create_receiver", () => {
  it("returns the strict output shape and forwards audience_mode", async () => {
    const client = makeStubClient({
      createReceiver: vi.fn().mockResolvedValue({
        id: "rcv_1",
        audienceMode: "b2b",
        createdAt: "2026-08-11T12:00:00Z",
      }),
    } as never);

    const result = await handleCreateReceiver(
      {
        audience_mode: "b2b",
        company_name: "Acme",
        contact_email: "person@acme.com",
      },
      client,
    );

    expect(result).toEqual({
      receiver_id: "rcv_1",
      audience_mode: "b2b",
      created_at: "2026-08-11T12:00:00Z",
    });
  });

  it("rejects b2b without company_name via cross-field validation", async () => {
    const client = makeStubClient();
    await expect(
      handleCreateReceiver({ audience_mode: "b2b", contact_email: "p@a.com" }, client),
    ).rejects.toThrow(/company_name is required/);
  });

  it("rejects b2c without receiver_email", async () => {
    const client = makeStubClient();
    await expect(
      handleCreateReceiver({ audience_mode: "b2c", receiver_first_name: "Ada" }, client),
    ).rejects.toThrow(/receiver_email is required/);
  });

  it("substitutes now() when server response omits createdAt", async () => {
    const client = makeStubClient({
      createReceiver: vi.fn().mockResolvedValue({ id: "rcv_x", audienceMode: "b2c" }),
    } as never);
    const result = await handleCreateReceiver(
      { audience_mode: "b2c", receiver_email: "a@b.co" },
      client,
    );
    expect(result.created_at).toBeTruthy();
    expect(() => new Date(result.created_at)).not.toThrow();
  });
});

describe("pitchmachine_generate_pitch", () => {
  const fakeClock = {
    _now: 0,
    now() {
      return this._now;
    },
    async sleep(ms: number) {
      this._now += ms;
    },
  };

  beforeEach(() => {
    fakeClock._now = 0;
  });

  it("creates, prepays, polls, returns deployed URL", async () => {
    const getPitch = vi
      .fn()
      .mockResolvedValueOnce({ id: "p_1", status: "generating" })
      .mockResolvedValueOnce({
        id: "p_1",
        status: "deployed",
        slug: "acme-cool-slug",
        shareToken: "tok123",
        receiverId: "rcv_1",
        generatedAt: "2026-08-11T12:05:00Z",
      });
    const client = makeStubClient({
      createPitch: vi.fn().mockResolvedValue({ id: "p_1", status: "generating" }),
      prepayPitch: vi.fn().mockResolvedValue(undefined),
      getPitch,
    } as never);

    const result = await handleGeneratePitch({ receiver_id: "rcv_1" }, client, fakeClock);
    expect(result.status).toBe("deployed");
    expect(result.public_url).toBe("https://pitchmachine.ai/p/acme-cool-slug?t=tok123");
    expect(result.pitch_id).toBe("p_1");
    expect(result.error).toBeNull();
  });

  it("returns insufficient_credits signal on 402 prepay", async () => {
    const client = makeStubClient({
      createPitch: vi.fn().mockResolvedValue({ id: "p_2", status: "draft" }),
      prepayPitch: vi.fn().mockRejectedValue(
        new PitchMachineApiError("out of credits", {
          status: 402,
          url: "x",
          body: null,
        }),
      ),
      getPitch: vi.fn(),
    } as never);

    const result = await handleGeneratePitch({ receiver_id: "rcv_2" }, client, fakeClock);
    expect(result.status).toBe("insufficient_credits");
    expect(result.pitch_id).toBe("p_2");
    expect(result.public_url).toBeNull();
    expect(result.error).toMatch(/credits/i);
  });

  it("respects poll_timeout_seconds and returns in-progress state", async () => {
    const client = makeStubClient({
      createPitch: vi.fn().mockResolvedValue({ id: "p_3", status: "generating" }),
      prepayPitch: vi.fn().mockResolvedValue(undefined),
      // Always says generating — the loop must give up on its own.
      getPitch: vi.fn().mockResolvedValue({ id: "p_3", status: "generating" }),
    } as never);

    const result = await handleGeneratePitch(
      { receiver_id: "rcv_3", poll_timeout_seconds: 10 },
      client,
      fakeClock,
    );
    expect(result.status).toBe("generating");
    expect(result.public_url).toBeNull();
  });

  it("surfaces terminal error status with API-provided message", async () => {
    const client = makeStubClient({
      createPitch: vi.fn().mockResolvedValue({ id: "p_4", status: "generating" }),
      prepayPitch: vi.fn().mockResolvedValue(undefined),
      getPitch: vi
        .fn()
        .mockResolvedValueOnce({ id: "p_4", status: "error", error: "brand fetch failed" }),
    } as never);
    const result = await handleGeneratePitch({ receiver_id: "rcv_4" }, client, fakeClock);
    expect(result.status).toBe("error");
    expect(result.error).toBe("brand fetch failed");
  });
});

describe("pitchmachine_get_pitch_url", () => {
  it("returns the shaped public URL for a deployed pitch", async () => {
    const client = makeStubClient({
      getPitch: vi.fn().mockResolvedValue({
        id: "p_1",
        status: "deployed",
        slug: "widget-co",
        shareToken: "abc",
        receiverId: "rcv_1",
        receiverEmail: "buyer@widget.co",
        generatedAt: "2026-08-11T12:00:00Z",
      }),
    } as never);

    const result = await handleGetPitchUrl({ pitch_id: "p_1" }, client);
    expect(result).toEqual({
      pitch_id: "p_1",
      status: "deployed",
      public_url: "https://pitchmachine.ai/p/widget-co?t=abc",
      receiver_id: "rcv_1",
      receiver_email: "buyer@widget.co",
      generated_at: "2026-08-11T12:00:00Z",
    });
  });

  it("returns null public_url when the pitch isn't ready", async () => {
    const client = makeStubClient({
      getPitch: vi.fn().mockResolvedValue({ id: "p_1", status: "generating" }),
    } as never);
    const result = await handleGetPitchUrl({ pitch_id: "p_1" }, client);
    expect(result.public_url).toBeNull();
  });
});

describe("pitchmachine_list_pitches", () => {
  it("maps API shape to agent shape", async () => {
    const client = makeStubClient({
      listPitches: vi.fn().mockResolvedValue([
        {
          id: "p_1",
          status: "deployed",
          slug: "one",
          shareToken: "t1",
          receiverId: "rcv_1",
          receiverEmail: "a@b.co",
          createdAt: "2026-08-11T10:00:00Z",
        },
        {
          id: "p_2",
          status: "generating",
          receiverId: "rcv_2",
        },
      ]),
    } as never);

    const result = await handleListPitches({ limit: 10 }, client);
    expect(result.total_returned).toBe(2);
    expect(result.pitches[0]).toEqual({
      pitch_id: "p_1",
      receiver_id: "rcv_1",
      receiver_email: "a@b.co",
      status: "deployed",
      public_url: "https://pitchmachine.ai/p/one?t=t1",
      created_at: "2026-08-11T10:00:00Z",
    });
    expect(result.pitches[1]?.public_url).toBeNull();
  });

  it("handles empty input (all filters optional)", async () => {
    const client = makeStubClient({
      listPitches: vi.fn().mockResolvedValue([]),
    } as never);
    const result = await handleListPitches({}, client);
    expect(result.total_returned).toBe(0);
    expect(result.pitches).toEqual([]);
  });

  it("rejects limit above 200 (Zod)", async () => {
    const client = makeStubClient({ listPitches: vi.fn() } as never);
    await expect(handleListPitches({ limit: 500 }, client)).rejects.toThrow();
  });
});

describe("derivePublicUrl", () => {
  it("prefers publicUrl over deployUrl over slug reconstruction", () => {
    expect(
      derivePublicUrl({
        id: "p",
        status: "deployed",
        publicUrl: "https://direct.example/x",
        deployUrl: "https://deploy.example/y",
        slug: "z",
        shareToken: "t",
      }),
    ).toBe("https://direct.example/x");

    expect(
      derivePublicUrl({
        id: "p",
        status: "deployed",
        deployUrl: "https://deploy.example/y",
        slug: "z",
        shareToken: "t",
      }),
    ).toBe("https://deploy.example/y");

    expect(
      derivePublicUrl({
        id: "p",
        status: "deployed",
        slug: "z",
        shareToken: "t",
      }),
    ).toBe("https://pitchmachine.ai/p/z?t=t");
  });

  it("returns null for pitches that aren't ready", () => {
    expect(derivePublicUrl({ id: "p", status: "generating" })).toBeNull();
  });

  it("omits the token when no shareToken is present", () => {
    expect(derivePublicUrl({ id: "p", status: "deployed", slug: "z" })).toBe(
      "https://pitchmachine.ai/p/z",
    );
  });
});
