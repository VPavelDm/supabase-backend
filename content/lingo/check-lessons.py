#!/usr/bin/env python3
"""Sanity-check each app's lesson content (content/lingo/<app>) against content/lingo/README.md.

- trail.json names only lessons that have a file (plus `checkpoint` as each chapter's last stump)
- every lesson follows the format: speakers, tasks, word examples taken from the scene,
  gaps that are a whole word of their phrase, swap sentences that fill their frame
- distractor tiles are not copies of the line's own tiles
- every text object has the learned language and all of the app's learner languages
  (plus `<code>_f` variants for a female learner, which Hejka's content has)
- the lines a female learner sees (`<code>_f`, `example_f`) pass the same checks as the plain ones
- tips (`tip`) sit on the lesson (`show: auto`) or on a phrase (`show: tap`) and have every learner language

Run from anywhere:  python3 content/lingo/check-lessons.py [hutarka|hejka]   (no argument: both)
publish.ts runs it before publishing, so nothing broken reaches the apps.
"""
import json
import sys
from pathlib import Path

CONTENT = Path(__file__).resolve().parent
# Per app: its content folder (trail.json + lessons/<id>.json), the language it teaches (the
# required key of every text object) and the learner languages the lessons are translated into.
# Keep in step with each app's AppConfig.swift in the iOS repo.
APPS = {
    "hutarka": (CONTENT / "hutarka", "en",
                ["es", "fr", "de", "it", "pt", "ru", "uk", "be", "pl", "tr", "zh", "zh-Hant", "ja", "ar", "hi"]),
    "hejka": (CONTENT / "hejka", "pl",
              ["en", "es", "fr", "de", "it", "pt", "ru", "uk", "be", "tr", "zh", "zh-Hant", "ja", "ar", "hi"]),
}
CHARACTERS = {"fox", "owl", "dog", "rabbit"}
MAPS = {"forest", "meadow", "farm"}
PUNCTUATION = ".,!?;:“”\"«»„…"


def bare(token: str) -> str:
    return token.strip(PUNCTUATION)


def check(app: str) -> int:
    ROOT, LEARNED, LOCALES = APPS[app]
    print(f"== {app}")
    problems: list[str] = []
    known = set(LOCALES) | {LEARNED}

    def text(obj, where):
        if not isinstance(obj, dict) or not obj.get(LEARNED):
            problems.append(f"{where}: needs a text object with `{LEARNED}`")
            return ""
        missing = [code for code in LOCALES if not obj.get(code)]
        if missing:
            problems.append(f"{where}: missing {', '.join(missing)}")
        unknown = {k for k in obj if k not in known and not (k.endswith("_f") and k[:-2] in known)}
        if unknown:
            problems.append(f"{where}: unknown language keys {sorted(unknown)}")
        return obj[LEARNED]

    trail = json.loads((ROOT / "trail.json").read_text(encoding="utf-8"))
    listed: list[str] = []
    for c, chapter in enumerate(trail["chapters"]):
        text(chapter["title"], f"trail chapter {c + 1}")
        units = chapter["units"]
        for u, unit in enumerate(units):
            where = f"trail chapter {c + 1} unit {u + 1}"
            text(unit["title"], where)
            if unit["map"] not in MAPS:
                problems.append(f"{where}: unknown map {unit['map']}")
            if len(unit["lessons"]) != 3:
                problems.append(f"{where}: needs 3 lessons")
            for i, lesson_id in enumerate(unit["lessons"]):
                is_last = u == len(units) - 1 and i == len(unit["lessons"]) - 1
                if lesson_id == "checkpoint":
                    if not is_last:
                        problems.append(f"{where}: `checkpoint` only as the chapter's last stump")
                    continue
                if is_last:
                    problems.append(f"{where}: the chapter's last stump must be `checkpoint`")
                listed.append(lesson_id)

    files = {p.stem for p in (ROOT / "lessons").glob("*.json")}
    for lesson_id in listed:
        if lesson_id not in files:
            problems.append(f"trail: no file for lesson {lesson_id}")
    for dup in sorted({i for i in listed if listed.count(i) > 1}):
        problems.append(f"trail: lesson {dup} listed twice")
    for extra in sorted(files - set(listed)):
        print(f"note: {extra}.json is not on the trail")

    def tip(obj, where, show):
        if not isinstance(obj, dict) or obj.get("show") != show or not isinstance(obj.get("text"), dict):
            problems.append(f"{where}: tip needs `show: {show}` and a `text` object")
            return
        missing = [code for code in LOCALES if not obj["text"].get(code)]
        if missing:
            problems.append(f"{where}: tip missing {', '.join(missing)}")
        unknown = set(obj["text"]) - set(LOCALES)
        if unknown:
            problems.append(f"{where}: tip has unknown language keys {sorted(unknown)}")

    def check_lesson(lesson, lid, female):
        """The format checks on the lines a male (`en`) or a female (`en_f` where given) learner sees."""
        found: list[str] = []

        def learned(obj):
            if not isinstance(obj, dict):
                return ""
            return (obj.get(f"{LEARNED}_f") if female else None) or obj.get(LEARNED, "")

        scene = lesson["scene"]
        lines = []
        for n, line in enumerate(scene):
            where = f"{lid} scene {n + 1}"
            en = learned(line["text"])
            lines.append(en)
            task = line.get("task")
            if line["speaker"] == "boar" and task and len(task) == 1:
                if "build" in task:
                    tiles = en.split(" ")
                    for tile in task["build"]:
                        if tile in tiles:
                            found.append(f"{where}: extra tile {tile!r} copies a tile of the line")
                elif "choose" in task and en in task["choose"]:
                    found.append(f"{where}: choose needs 2 wrong replies, not the line itself")

        for w in lesson["words"]:
            en = learned(w["text"])
            example = (w.get("example_f") if female else None) or w["example"]
            if example not in lines:
                found.append(f"{lid} word {en!r}: example {example!r} is not a scene line")

        for p in lesson["phrases"]:
            en = learned(p["text"])
            where = f"{lid} phrase {en!r}"
            tokens = en.split(" ")
            gap = p["gap"]
            matches = [t for t in tokens if bare(t) == gap]
            if len(matches) != 1:
                found.append(f"{where}: gap {gap!r} must be exactly one whole word of it")
            elif en.find(gap) != en.find(matches[0]) + matches[0].find(gap):
                found.append(f"{where}: gap {gap!r} appears inside an earlier word")
            for tile in p["distractors"]:
                if tile in tokens:
                    found.append(f"{where}: distractor {tile!r} copies a tile of the phrase")

        frame = lesson["swap"]["frame"]
        for item in lesson["swap"]["items"]:
            word, sentence = learned(item["word"]), learned(item["sentence"])
            if sentence != frame.replace("{slot}", word):
                found.append(f"{lid} swap: {sentence!r} is not the frame filled with {word!r}")
        return found

    for path in sorted((ROOT / "lessons").glob("*.json")):
        lesson = json.loads(path.read_text(encoding="utf-8"))
        lid = path.stem
        if lesson.get("id") != lid:
            problems.append(f"{lid}: id must equal the file name")
        text(lesson.get("title"), f"{lid} title")
        text(lesson.get("subtitle"), f"{lid} subtitle")
        if lesson.get("with") not in CHARACTERS:
            problems.append(f"{lid}: `with` must be one of {sorted(CHARACTERS)}")
        if "tip" in lesson:
            tip(lesson["tip"], f"{lid}", "auto")

        scene = lesson["scene"]
        if not 4 <= len(scene) <= 8:
            problems.append(f"{lid}: scene needs 4–8 lines")
        if scene and scene[0]["speaker"] != "other":
            problems.append(f"{lid}: scene starts with the other speaker")
        for n, line in enumerate(scene):
            where = f"{lid} scene {n + 1}"
            text(line["text"], where)
            if "tip" in line:
                problems.append(f"{where}: a tip goes on the lesson or a phrase, not a scene line")
            task = line.get("task")
            if line["speaker"] == "boar":
                if not task or len(task) != 1:
                    problems.append(f"{where}: a boar line needs one task")
                elif "build" in task and len(task["build"]) != 2:
                    problems.append(f"{where}: build needs 2 extra tiles")
                elif "choose" in task and len(task["choose"]) != 2:
                    problems.append(f"{where}: choose needs 2 wrong replies, not the line itself")
            elif line["speaker"] == "other":
                if task:
                    problems.append(f"{where}: only boar lines have a task")
            else:
                problems.append(f"{where}: speaker must be boar or other")

        words = lesson["words"]
        if not 4 <= len(words) <= 6:
            problems.append(f"{lid}: needs 4–6 words")
        for w in words:
            en = text(w["text"], f"{lid} word")
            if "tip" in w:
                problems.append(f"{lid} word {en!r}: a tip goes on the lesson or a phrase, not a word")

        phrases = lesson["phrases"]
        if not 2 <= len(phrases) <= 4:
            problems.append(f"{lid}: needs 2–4 phrases")
        for p in phrases:
            en = text(p["text"], f"{lid} phrase")
            where = f"{lid} phrase {en!r}"
            if len(p["gapWrong"]) != 2 or p["gap"] in p["gapWrong"]:
                problems.append(f"{where}: gapWrong needs 2 words other than the gap")
            if len(p["distractors"]) != 2:
                problems.append(f"{where}: needs 2 distractors")
            if "tip" in p:
                tip(p["tip"], where, "tap")

        swap = lesson["swap"]
        if swap["frame"].count("{slot}") != 1:
            problems.append(f"{lid} swap: frame needs {{slot}} exactly once")
        if len(swap["items"]) != 3:
            problems.append(f"{lid} swap: needs 3 items")
        for item in swap["items"]:
            text(item["word"], f"{lid} swap word")
            text(item["sentence"], f"{lid} swap sentence")

        # The same checks on what a female learner sees, reporting only what differs.
        male = check_lesson(lesson, lid, female=False)
        problems.extend(male)
        problems.extend(f"(female) {p}" for p in check_lesson(lesson, lid, female=True) if p not in male)

    for p in problems:
        print(p)
    print(f"{len(problems)} problem(s) in {len(listed)} lessons")
    return 1 if problems else 0


def main() -> int:
    apps = sys.argv[1:] or list(APPS)
    unknown = [a for a in apps if a not in APPS]
    if unknown:
        print(f"unknown app(s) {unknown}; pick from {list(APPS)}")
        return 2
    return max(check(app) for app in apps)


if __name__ == "__main__":
    sys.exit(main())
