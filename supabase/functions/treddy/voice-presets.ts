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

// The writing rules from the "Basic minimum for Threads" guide every voice
// below carries in its notes, so they stay visible and editable in the copy
// the user makes.
const RULES = {
  en: "Start with the point: no greeting, no intro. Open with intrigue, a benefit " +
    "or a problem. One idea per post. Be concrete: numbers, details and my own " +
    "examples instead of general advice. Show actions, not descriptions. Mix " +
    "short and long sentences. Simple words. End with something the reader takes away.",
  ru: "Сразу к сути: без приветствий и вступлений. Начинай с интриги, выгоды или " +
    "проблемы. Одна мысль на пост. Конкретика: цифры, детали и примеры из моего " +
    "опыта вместо общих советов. Показывай действия, а не описания. Чередуй " +
    "короткие и длинные предложения. Простые слова. В конце дай читателю вывод.",
};

const PRESETS: Preset[] = [
  {
    id: "mix",
    tones: ["educational", "bold"],
    formats: ["howTo", "lists", "myths", "mistakes", "results"],
    text: {
      en: {
        name: "Mix",
        description: "Mostly useful posts, some myth busting, now and then a sale.",
        notes: "About 3 in 4 posts give practical value, 1 in 4 busts a myth or names a " +
          "common mistake, and at most one a week shows my results or what I sell. " +
          "What I sell: (write it here). Use only results and numbers I wrote here, " +
          "never invent them. Now and then bring back an idea from my best posts with " +
          "a new opening.\n\n" + RULES.en,
      },
      ru: {
        name: "Микс",
        description: "В основном польза, иногда разбор мифов и изредка продажа.",
        notes: "Примерно 3 из 4 постов дают практическую пользу, 1 из 4 разбирает миф или " +
          "частую ошибку, и не больше одного в неделю показывает мои результаты или то, " +
          "что я продаю. Что я продаю: (впиши сюда). Используй только результаты и " +
          "цифры, которые я здесь написал, никогда их не выдумывай. Иногда возвращай " +
          "идею из моих лучших постов с новым началом.\n\n" + RULES.ru,
      },
    },
  },
  {
    id: "useful",
    tones: ["educational"],
    formats: ["howTo", "lists", "tips"],
    text: {
      en: {
        name: "Useful",
        description: "How-tos, lists and tips that help right away.",
        notes: "Give practical value the reader can use today: a how-to, a list or a " +
          "tip that solves one problem.\n\n" + RULES.en,
      },
      ru: {
        name: "Польза",
        description: "Инструкции, списки и советы, которые помогают сразу.",
        notes: "Давай практическую пользу, которую читатель применит сегодня: " +
          "инструкцию, список или совет, решающий одну проблему.\n\n" + RULES.ru,
      },
    },
  },
  {
    id: "myth-buster",
    tones: ["bold"],
    formats: ["myths", "mistakes"],
    text: {
      en: {
        name: "Myth buster",
        description: "Busts myths and common mistakes, and shows what works instead.",
        notes: "Name a myth or a mistake people in my topic believe, explain the real " +
          "cause and what to do instead. Lead the reader to the conclusion, don't " +
          "lecture.\n\n" + RULES.en,
      },
      ru: {
        name: "Разрушитель мифов",
        description: "Разбирает мифы и частые ошибки и показывает, что работает.",
        notes: "Назови миф или ошибку, в которые верят люди в моей теме, объясни " +
          "настоящую причину и что делать вместо этого. Подводи читателя к выводу, " +
          "а не поучай.\n\n" + RULES.ru,
      },
    },
  },
  {
    id: "sell",
    tones: ["warm"],
    formats: ["results", "behindTheScenes"],
    text: {
      en: {
        name: "Sell",
        description: "Shows why to choose you: results, cases and how you work.",
        notes: "What I sell: (write it here). Show why to pick me: real results and " +
          "cases, how my approach differs, my firm opinions, my own before and after. " +
          "Use only results and numbers I wrote here, never invent them. No hard " +
          "sell and no promises of quick money.\n\n" + RULES.en,
      },
      ru: {
        name: "Продажи",
        description: "Показывает, почему выбрать тебя: результаты, кейсы, подход.",
        notes: "Что я продаю: (впиши сюда). Покажи, почему выбрать меня: реальные " +
          "результаты и кейсы, чем отличается мой подход, мои твёрдые позиции, мои " +
          "«до и после». Используй только результаты и цифры, которые я здесь " +
          "написал, никогда их не выдумывай. Без давления и обещаний быстрых " +
          "денег.\n\n" + RULES.ru,
      },
    },
  },
  {
    id: "series",
    tones: ["casual"],
    formats: ["series"],
    text: {
      en: {
        name: "Series",
        description: "One theme, numbered: Day 1, Day 2…",
        notes: "Series: (write its name here, like \"What I eat every day\"). Each post " +
          "opens with the series name and its number. Start from 1 unless I write " +
          "another number here.\n\n" + RULES.en,
      },
      ru: {
        name: "Серия",
        description: "Одна тема с номерами: день 1, день 2…",
        notes: "Серия: (впиши название, например «Что я ем каждый день»). Каждый пост " +
          "начинается с названия серии и номера. Начинай с 1, если я не написал здесь " +
          "другой номер.\n\n" + RULES.ru,
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
