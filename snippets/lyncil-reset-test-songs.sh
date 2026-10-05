#!/usr/bin/env bash
# Makes Pavel's two Lyncil test profiles on production fresh again, so the next
# launch goes through onboarding: their stored tracks are deleted and their
# profile rows go, which cascades to their songs, song jobs and Dislike
# feedback. The auth user stays, so the session in the device's Keychain still
# works; the app's next lyncil_ensure_profile() makes a new profile with
# onboarded_at null, and the free song is back.
#
# Test accounts only: a real user's profile, songs and tracks are kept for good.
#
#   ./snippets/lyncil-reset-test-songs.sh
#
# Then delete the app from the device and install it again: the app also keeps
# "onboarding done" in UserDefaults and would skip onboarding without asking
# the backend. The Keychain survives the reinstall, so it signs in as the same
# user.
#
# Shows what is there, asks for "wipe", then deletes. Needs the supabase CLI
# logged in and linked to the Lyncil project.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="ttjzshiaatqvszckjlhw"
PROFILES=(
  "b260fc15-7620-4040-a4da-803db20a8ce3"
  "c4ce1019-653e-46b2-8bf8-43dce994566f"
)

linked="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
if [[ "$linked" != "$PROJECT_REF" ]]; then
  echo "Linked project is '${linked:-none}', not Lyncil ($PROJECT_REF). Run: supabase link --project-ref $PROJECT_REF" >&2
  exit 1
fi

ids=$(printf "'%s'," "${PROFILES[@]}")
ids="${ids%,}"

# Runs SQL on the linked project and prints its rows as JSON. The CLI prints a
# plain list in a terminal and {"rows": …} when an AI tool runs it; now and
# then it answers with an error object instead, so one retry, then the error.
query() {
  local out
  for attempt in 1 2; do
    out=$(supabase db query --linked --output-format json "$1" 2>/dev/null || true)
    if printf '%s' "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else d.get("rows")
if rows is None: sys.exit(1)
print(json.dumps(rows))
' 2>/dev/null; then return 0; fi
    sleep 2
  done
  echo "Query failed. The CLI answered: $out" >&2
  return 1
}

summary() {
  query "
    select p.id as profile,
      (select case when pr.id is null then 'none'
                   when pr.onboarded_at is null then 'not onboarded'
                   else 'onboarded ' || pr.onboarded_at::date end
         from (select 1) one left join lyncil.profiles pr on pr.id = p.id) as state,
      (select count(*) from lyncil.songs s where s.user_id = p.id) as songs,
      (select count(*) from lyncil.song_jobs j where j.user_id = p.id) as jobs,
      (select count(*) from lyncil.song_feedback f where f.user_id = p.id) as feedback,
      (select count(*) from storage.objects o where o.bucket_id = 'lyncil-tracks' and o.name like p.id || '/%') as files
    from (select unnest(array[$ids]::uuid[]) as id) p" |
    python3 -c '
import json, sys
rows = json.load(sys.stdin)
print("%-38s %-21s %6s %5s %9s %6s" % ("profile", "state", "songs", "jobs", "feedback", "files"))
for r in rows:
    print("%-38s %-21s %6s %5s %9s %6s" % (r["profile"], r["state"], r["songs"], r["jobs"], r["feedback"], r["files"]))
'
}

echo "Before:"
summary
echo
read -r -p "Delete these profiles (with their songs, jobs, feedback) and tracks on production? Type 'wipe' to continue: " answer
if [[ "$answer" != "wipe" ]]; then
  echo "Nothing changed."
  exit 1
fi

# Files first: if the SQL below failed, the songs would still point at what's left.
for id in "${PROFILES[@]}"; do
  count=$(query "select count(*) as n from storage.objects where bucket_id = 'lyncil-tracks' and name like '$id/%'" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)[0]["n"])')
  if [[ "$count" -gt 0 ]]; then
    supabase storage rm -r --linked --experimental "ss:///lyncil-tracks/$id"
  fi
done

query "delete from lyncil.profiles where id in ($ids)" >/dev/null

echo
echo "After:"
summary
echo
echo "Now delete the app from the device and install it again."
