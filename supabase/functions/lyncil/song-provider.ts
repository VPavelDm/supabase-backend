// What generate-song and song-status need from a text-to-music provider, so
// the routes (and the app) stay the same whichever one makes the track.
// Whatever the provider hands back, song-status keeps the finished track in
// the lyncil-tracks bucket and serves the app from there.

export type Voice = "male" | "female" | "instrumental";
export type Kind = "song" | "instrumental";
export type Provider = "mureka" | "google";

export interface SongInput {
  lyrics: string;
  genre: string;
  mood: string;
  voice: Voice;
}

/// A finished track arrives one of two ways: a link the app downloads
/// (Mureka's CDN) or the audio itself, base64 (Lyria returns it inline).
export type SongStatus =
  | { status: "pending" }
  | { status: "failed" }
  | {
    status: "succeeded";
    audioUrl?: string;
    audioData?: string;
    mimeType?: string;
    duration: number | null;
  };

export interface StartedTask {
  taskId: string;
}

/// The row song-status reads before asking the provider anything.
export interface SongJob {
  taskId: string;
  kind: Kind;
}

export class ProviderBusyError extends Error {}
