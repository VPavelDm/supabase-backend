#!/usr/bin/env bash
# Puts a finished song made outside the app (an mp3 from lyncil-try-lyria.ts,
# say) into one of Pavel's test profiles, with a share link:
#
#   ./snippets/lyncil-add-song.sh [--local] <profile id> <track.mp3> <title> <genre> <lyrics.txt>
#
#   genre   the app's raw value: pop, hipHop, rAndB, rock, jazz, blues,
#           electronic, reggae, country, alternative, indie, folk, punk,
#           vocal, metal, latin, gospel, kPop, soul
#
# Uploads the track to lyncil-tracks/<profile>/<song id>.mp3, then in one
# statement adds the song (with audio_file_name set, so the app treats it as
# finished and fetches the track through song-status like after a
# reinstall), a succeeded song_jobs row pointing at the track, and a live
# lyncil.song_shares link. Prints the link.
#
# Test profiles only (the two in lyncil-reset-test-songs.sh, which also wipes
# what this adds). The job row counts toward that profile's song allowance.
# Default target is the linked production project; --local uses the local stack.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="ttjzshiaatqvszckjlhw"
TEST_PROFILES=("b260fc15-7620-4040-a4da-803db20a8ce3" "c4ce1019-653e-46b2-8bf8-43dce994566f")
GENRES=" pop hipHop rAndB rock jazz blues electronic reggae country alternative indie folk punk vocal metal latin gospel kPop soul "

TARGET=linked
if [[ "${1:-}" == "--local" ]]; then TARGET=local; shift; fi
[[ $# -eq 5 ]] || { sed -n 2,9p "$0"; exit 1; }
PROFILE="$1"; TRACK="$2"; TITLE="$3"; GENRE="$4"; LYRICS_FILE="$5"

[[ -f "$TRACK" ]] || { echo "No track at $TRACK" >&2; exit 1; }
[[ -s "$LYRICS_FILE" ]] || { echo "No lyrics in $LYRICS_FILE" >&2; exit 1; }
[[ -n "${TITLE// /}" ]] || { echo "Empty title" >&2; exit 1; }
[[ "$GENRES" == *" $GENRE "* ]] || { echo "Unknown genre '$GENRE'" >&2; exit 1; }

if [[ "$TARGET" == linked ]]; then
  [[ " ${TEST_PROFILES[*]} " == *" $PROFILE "* ]] || { echo "$PROFILE is not one of the test profiles" >&2; exit 1; }
  linked="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
  [[ "$linked" == "$PROJECT_REF" ]] || { echo "Linked project is '${linked:-none}', not Lyncil" >&2; exit 1; }
  API="https://$PROJECT_REF.supabase.co"
  SERVICE="$(supabase projects api-keys --project-ref "$PROJECT_REF" -o json 2>/dev/null \
    | python3 -c "import json,sys;print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")"
  QUERY=(supabase db query --linked)
else
  STATUS="$(supabase status -o json 2>/dev/null)"
  API="$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['API_URL'])" "$STATUS")"
  SERVICE="$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['SERVICE_ROLE_KEY'])" "$STATUS")"
  QUERY=(supabase db query --local)
fi
[[ -n "$SERVICE" ]] || { echo "No service key" >&2; exit 1; }

SONG_ID="$(uuidgen | tr 'A-Z' 'a-z')"
SLUG="$(python3 -c "import secrets,string;a=string.ascii_letters+string.digits;print(''.join(secrets.choice(a) for _ in range(12)))")"
DURATION="$(afinfo "$TRACK" | awk '/estimated duration/ {print $3}')"
TRACK_PATH="$PROFILE/$SONG_ID.mp3"
# Dollar-quote tags no lyrics can contain.
TAG="l$(python3 -c "import secrets;print(secrets.token_hex(6))")"

profile_exists="$("${QUERY[@]}" --output-format json "select count(*) as n from lyncil.profiles where id = '$PROFILE'" 2>/dev/null \
  | python3 -c "
import json, sys
text = sys.stdin.read()
# A plain list in a terminal; inside an AI agent the CLI wraps it as {rows: …}.
data = json.loads(text[min(i for i in (text.find('['), text.find('{')) if i >= 0):])
print((data['rows'] if isinstance(data, dict) else data)[0]['n'])")"
[[ "$profile_exists" == "1" ]] || { echo "No lyncil.profiles row for $PROFILE" >&2; exit 1; }

echo "Uploading $TRACK → lyncil-tracks/$TRACK_PATH"
curl -sf -X POST "$API/storage/v1/object/lyncil-tracks/$TRACK_PATH" \
  -H "Authorization: Bearer $SERVICE" -H "Content-Type: audio/mpeg" \
  --data-binary @"$TRACK" -o /dev/null
unset SERVICE

SQL="$(mktemp)"
trap 'rm -f "$SQL"' EXIT
cat > "$SQL" <<EOF
with song as (
  insert into lyncil.songs (id, user_id, name, lyrics, genre, voice, audio_file_name, audio_duration, modified_at)
  values ('$SONG_ID', '$PROFILE', \$$TAG\$$TITLE\$$TAG\$, \$$TAG\$$(cat "$LYRICS_FILE")\$$TAG\$,
          '$GENRE', 'male', '$SONG_ID.mp3', $DURATION, now())
  returning id
), job as (
  insert into lyncil.song_jobs (task_id, user_id, kind, provider, status, audio_path, audio_duration, song_id)
  select 'manual-' || id, '$PROFILE', 'song', 'google', 'succeeded', '$TRACK_PATH', $DURATION, id from song
  returning song_id
)
insert into lyncil.song_shares (slug, song_id, user_id)
select '$SLUG', song_id, '$PROFILE' from job
returning slug;
EOF
"${QUERY[@]}" -f "$SQL" >/dev/null

echo "Song:  $SONG_ID"
echo "Link:  https://music.lyncil.com/s/$SLUG"
