import type { PitchApiResponse } from "../types.js";

/**
 * Turn whatever the Pitch Machine API returned into the canonical public
 * URL that the receiver would see. There are three cases in the wild:
 *
 * 1. The server already gave us a fully-qualified `publicUrl`. Trust it.
 * 2. The server gave us a `deployUrl` (a Vercel deploy or CDN). Use it.
 * 3. The server gave us `slug` + `shareToken`. We reconstruct the canonical
 *    format documented on /agents: `https://pitchmachine.ai/p/<slug>?t=<token>`.
 *
 * Returns null when the pitch isn't ready yet (no slug, no url).
 */
export function derivePublicUrl(pitch: PitchApiResponse): string | null {
  if (pitch.publicUrl && typeof pitch.publicUrl === "string") return pitch.publicUrl;
  if (pitch.deployUrl && typeof pitch.deployUrl === "string") return pitch.deployUrl;
  if (pitch.slug) {
    const base = "https://pitchmachine.ai";
    const token = pitch.shareToken ? `?t=${encodeURIComponent(pitch.shareToken)}` : "";
    return `${base}/p/${encodeURIComponent(pitch.slug)}${token}`;
  }
  return null;
}
