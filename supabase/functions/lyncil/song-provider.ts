// What generate-song and song-status need from a text-to-music provider, so
// the routes (and the app) stay the same whichever one makes the track.

export type Voice = "male" | "female" | "instrumental";
export type Kind = "song" | "instrumental";
export type Provider = "mureka" | "google";

export interface SongInput {
  lyrics: string;
  genre: string;
  mood: string;
  voice: Voice;
}

export type SongStatus =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "succeeded"; audioUrl: string; duration: number | null };

/// A started task. `background` is work that must keep running after the
/// response goes out (Lyria without background mode); the route hands it to
/// EdgeRuntime.waitUntil once the job row exists.
export interface StartedTask {
  taskId: string;
  background?: () => Promise<void>;
}

/// The row song-status reads before asking the provider anything.
export interface SongJob {
  taskId: string;
  userId: string;
  kind: Kind;
  status: "pending" | "succeeded" | "failed";
  audioPath: string | null;
}

export class ProviderBusyError extends Error {}
