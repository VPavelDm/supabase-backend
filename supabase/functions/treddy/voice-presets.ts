// Ready-made voices the app offers under "+" in Voices, so nobody has to
// start from a blank form. Picking one makes the user's own copy, which they
// finish with a topic and their posts; nothing here touches saved voices.
// Served from here so the list can change without an app release. Public
// content, no account involved: no auth.
//
// GET ?language=ru — the app's UI language; anything not translated gets
// English. Tones and formats are the raw values settings.ts accepts.

import { json } from "./db.ts";

interface Preset {
  id: string;
  tones: string[];
  formats: string[];
  text: Record<string, { name: string; description: string; notes: string }>;
}

const PRESETS: Preset[] = [
  {
    id: "teacher",
    tones: ["warm", "educational"],
    formats: ["tips", "questions"],
    text: {
      en: {
        name: "Teacher",
        description: "Explains one idea at a time, simply, with an example.",
        notes: "One idea per post, with a concrete example. Simple words, no jargon. " +
          "Now and then, end with a question so people answer.",
      },
      ru: {
        name: "Учитель",
        description: "Объясняет по одной идее, просто и с примером.",
        notes: "Одна идея на пост и конкретный пример. Простые слова, без жаргона. " +
          "Иногда заканчивай вопросом, чтобы люди отвечали.",
      },
    },
  },
  {
    id: "hot-takes",
    tones: ["bold", "witty"],
    formats: ["hotTakes"],
    text: {
      en: {
        name: "Hot takes",
        description: "Strong opinions that start a discussion.",
        notes: "Open with a clear opinion in the first line, then give one reason for it. " +
          "Disagree with ideas, never with people.",
      },
      ru: {
        name: "Смелые мнения",
        description: "Сильные мнения, которые запускают обсуждение.",
        notes: "Начинай с чёткого мнения в первой строке, затем дай одну причину. " +
          "Спорь с идеями, а не с людьми.",
      },
    },
  },
  {
    id: "storyteller",
    tones: ["warm", "casual"],
    formats: ["stories"],
    text: {
      en: {
        name: "Storyteller",
        description: "Short moments from your own life, and what they taught you.",
        notes: "Tell one small moment from your own life: what happened, how it felt, " +
          "what you took from it. Start in the middle of it.",
      },
      ru: {
        name: "Рассказчик",
        description: "Короткие истории из жизни и что они дали.",
        notes: "Расскажи один небольшой момент из своей жизни: что случилось, что ты " +
          "почувствовал, что из этого вынес. Начинай с середины событий.",
      },
    },
  },
  {
    id: "build-in-public",
    tones: ["casual"],
    formats: ["behindTheScenes"],
    text: {
      en: {
        name: "Build in public",
        description: "Progress, numbers and mistakes from what you're building.",
        notes: "Share real progress from what you're building: numbers, decisions, " +
          "mistakes. Be honest about what isn't working yet.",
      },
      ru: {
        name: "Строю публично",
        description: "Прогресс, цифры и ошибки того, что ты создаёшь.",
        notes: "Делись реальным прогрессом того, что строишь: цифры, решения, ошибки. " +
          "Честно говори о том, что пока не работает.",
      },
    },
  },
  {
    id: "coach",
    tones: ["inspiring"],
    formats: ["challenges"],
    text: {
      en: {
        name: "Coach",
        description: "One small action people can take today.",
        notes: "Give one small action the reader can take today, and talk to them " +
          "directly. Encouraging, never preachy.",
      },
      ru: {
        name: "Коуч",
        description: "Одно маленькое действие, которое можно сделать сегодня.",
        notes: "Дай одно маленькое действие, которое читатель может сделать сегодня, и " +
          "обращайся к нему напрямую. Поддерживай, но без нравоучений.",
      },
    },
  },
];

export function handleVoicePresets(req: Request): Response {
  const language = new URL(req.url).searchParams.get("language") ?? "en";
  return json({
    presets: PRESETS.map((preset) => {
      const text = preset.text[language] ?? preset.text.en;
      return { id: preset.id, tones: preset.tones, formats: preset.formats, ...text };
    }),
  });
}
