// The language-learning apps that share the `lingo` function: Hutarka teaches
// English, Hejka Polish, and the next one adds an entry here. Each app proves
// itself with its own key (x-lingo-app-key, secret LINGO_<APP>_APP_KEY), and
// everything about how it sounds lives here rather than in the binary — the
// language, the ElevenLabs model and the voices by role — so swapping a voice
// is a redeploy, not an App Store release (and a different voice id means a
// different cache key, so old clips simply stop being hit).

export interface LingoApp {
  id: string;
  /// The iOS bundle id: the APNs topic of the win-back push (winback.ts).
  bundleID: string;
  /// ISO 639-1 code of the language the app teaches: what every clip is spoken in.
  language: string;
  modelId: string;
  /// The roles an app may ask for. `narrator` reads words, phrases and the
  /// learner's own lines; `partner` is the other speaker in a scene.
  voices: Record<string, string>;
  /// 0.7–1.2. Learners hear new phrases a touch under native speed.
  speed: number;
}

// Premade ElevenLabs voices (every account has them) until each app picks
// its own. Turbo v2.5 is half the price of Multilingual v2 and fine for
// English; Polish sounds better on Multilingual v2.
export const APPS: Record<string, LingoApp> = {
  hutarka: {
    id: "hutarka",
    bundleID: "com.vaitsikhouski.pavel.mywords",
    language: "en",
    modelId: "eleven_turbo_v2_5",
    voices: {
      narrator: "EXAVITQu4vr4xnSDxMaL", // Sarah
      partner: "nPczCjzI2devNBz1zQrb", // Brian
    },
    speed: 0.9,
  },
  hejka: {
    id: "hejka",
    bundleID: "com.hejka",
    language: "pl",
    modelId: "eleven_multilingual_v2",
    voices: {
      narrator: "XrExE9yKIg1WjnnlVkGX", // Matilda
      partner: "CwhRBWXzGAHq8TQ4Fs17", // Roger
    },
    speed: 0.9,
  },
};
