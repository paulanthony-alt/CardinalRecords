#!/bin/bash
# Cardinal Records full test run: starts a throwaway Postgres, runs every suite
# against a local copy of the app, and writes a summary. Used by the weekly check.
#
#   bash tests/run-all.sh            # everything
#   SKIP_UI=1 bash tests/run-all.sh  # API suites only (no browser)
#
# Needs Postgres 14+ binaries and Node 22. The browser suites need Playwright
# (pre-installed in Claude's cloud sessions); they're skipped if it's missing.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"; : > "$SUMMARY"
PORT_APP=3199; PORT_PG=5439
export BASE="http://localhost:$PORT_APP"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$PGBIN" ] || { echo "Postgres binaries not found"; exit 2; }
[ -d "$REPO/node_modules" ] || (cd "$REPO" && npm ci --silent)

# --- throwaway Postgres cluster (owned by the postgres user when run as root)
PGDATA="/var/lib/postgresql/cr-tests-$$"
AS=""; if [ "$(id -u)" = 0 ]; then AS="su postgres -c"; mkdir -p "$PGDATA" && chown postgres "$PGDATA"; else PGDATA="$OUT/pgdata"; fi
run() { if [ -n "$AS" ]; then $AS "$1"; else bash -c "$1"; fi; }
run "$PGBIN/initdb -D $PGDATA -A trust -U postgres >/dev/null" || { echo "initdb failed"; exit 2; }
run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PORT_PG -k /tmp' -l $PGDATA/log -w start >/dev/null" || { echo "Postgres did not start"; exit 2; }
cleanup() { run "$PGBIN/pg_ctl -D $PGDATA -m fast stop >/dev/null" 2>/dev/null; rm -rf "${PGDATA:?}"; }
trap cleanup EXIT
psql() { PGOPTIONS="-c client_min_messages=warning" "$PGBIN/psql" -h localhost -p $PORT_PG -U postgres -qAt "$@"; }
fresh() { psql -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1"; }
APP=""
start() { (cd "$REPO" && DATABASE_URL="postgres://postgres@localhost:$PORT_PG/$1" OWNER_ACCOUNTS="$2" PORT=$PORT_APP exec node server.js >> "$OUT/server.log" 2>&1) & APP=$!
  for _ in $(seq 1 50); do curl -s "$BASE/healthz" >/dev/null && return 0; sleep 0.2; done; echo "app did not start"; return 1; }
stop() { [ -n "$APP" ] && kill "$APP" 2>/dev/null; wait "$APP" 2>/dev/null; APP=""; sleep 0.3; }
# record NAME OUTPUT-FILE: a suite passes when it printed "N passed, 0 failed" (or the given pattern) and no FAIL line
record() { local name="$1" file="$2" want="${3:-passed, 0 failed}"
  if grep -q "$want" "$file" && ! grep -q "^FAIL" "$file"; then local n; n=$(grep -oE '[0-9]+ passed' "$file" | tail -1); echo "PASS  $name${n:+  ($n)}" >> "$SUMMARY";
  else echo "FAIL  $name" >> "$SUMMARY"; grep -E "^FAIL|Error|error" "$file" | head -8 | sed 's/^/      /' >> "$SUMMARY"; fi; }
T="$REPO/tests"; OWN="BFreeds:1234:Dr. Freedman,JPolise:1234:Mr. Polise"
HAVE_UI=0; [ -z "${SKIP_UI:-}" ] && NODE_PATH="$(npm root -g)" node -e "require('playwright')" 2>/dev/null && HAVE_UI=1
export NODE_PATH="$(npm root -g)"

node "$T/schooldays.test.js" > "$OUT/schooldays.txt" 2>&1; record "School-day due dates (weekends skipped)" "$OUT/schooldays.txt"
fresh cr_codes; start cr_codes "tester:0000:Tester" && node "$T/signup-codes.test.js" "$OUT" > "$OUT/codes.txt" 2>&1; stop; record "Sign-up codes and season delete" "$OUT/codes.txt"
fresh cr_lobby; start cr_lobby "tester:0000:Tester" && node "$T/lobby.test.js" "$OUT" > "$OUT/lobby.txt" 2>&1; stop; record "Lobby controls (hide, pin, delete, mute, chat modes)" "$OUT/lobby.txt"
fresh cr_prof; start cr_prof "tester:0000:Tester" && node "$T/profiles.test.js" "$OUT" > "$OUT/profiles.txt" 2>&1; stop; record "Artist profile links" "$OUT/profiles.txt"
fresh cr_tools; start cr_tools "tester:0000:Tester" && PGURL="postgres://postgres@localhost:$PORT_PG/cr_tools" node "$T/class-tools.test.js" "$OUT" > "$OUT/tools.txt" 2>&1; stop; record "Job board, deadlines, class mode, undo, paste roster, reports" "$OUT/tools.txt"
fresh cr_chal; start cr_chal "tester:0000:Tester" && node "$T/challenges.test.js" "$OUT" > "$OUT/challenges.txt" 2>&1; stop; record "Studio challenges (date ranges, entries, winners)" "$OUT/challenges.txt"
fresh cr_studio; start cr_studio "tester:0000:Tester" && PGURL="postgres://postgres@localhost:$PORT_PG/cr_studio" node "$T/studio.test.js" "$OUT" > "$OUT/studio.txt" 2>&1; stop; record "Studio time requests" "$OUT/studio.txt"
fresh cr_class; start cr_class "$OWN" && node "$T/classroom.test.js" "$OUT" > "$OUT/class.txt" 2>&1; record "Classroom flows (30 students)" "$OUT/class.txt"
if [ $HAVE_UI = 1 ]; then node "$T/every-page.ui.js" "$OUT" 2>&1 | grep -v "401 (Unauthorized)" > "$OUT/pages.txt"; [ -s "$OUT/pages.txt" ] || echo "no problems" > "$OUT/pages.txt"; record "Every page, student + owner, phone + laptop" "$OUT/pages.txt" "no problems"; fi
node "$T/drift.js" save "$OUT" >/dev/null 2>&1; stop; start cr_class "$OWN"; node "$T/drift.js" compare "$OUT" > "$OUT/drift.txt" 2>&1; record "Shared cache matches the database" "$OUT/drift.txt" "PASS cached"
node "$T/stress.js" > "$OUT/stress.txt" 2>&1; node "$T/drift.js" save "$OUT" >/dev/null 2>&1; stop; start cr_class "$OWN"; node "$T/drift.js" compare "$OUT" >> "$OUT/stress.txt" 2>&1; stop
record "Stress: 30 students at once, then cache check" "$OUT/stress.txt" " 0 server errors"; grep -q "PASS cached" "$OUT/stress.txt" || echo "FAIL  Stress cache check" >> "$SUMMARY"
fresh cr_backup; start cr_backup "tester:0000:Tester" && node "$T/backups-offload.test.js" "$OUT" > "$OUT/backup.txt" 2>&1; stop; record "Fixes, PDF backups and offload" "$OUT/backup.txt"
if [ $HAVE_UI = 1 ]; then
  fresh cr_signup; start cr_signup "tester:0000:Tester" && node "$T/signup.ui.js" "$OUT" > "$OUT/signup.txt" 2>&1; stop
  grep -q "student signed in: true" "$OUT/signup.txt" && grep -q "JS errors: none" "$OUT/signup.txt" && echo "PASS  Sign-up in the browser" >> "$SUMMARY" || { echo "FAIL  Sign-up in the browser" >> "$SUMMARY"; sed 's/^/      /' "$OUT/signup.txt" | head -8 >> "$SUMMARY"; }
  fresh cr_guide; start cr_guide "tester:0000:Tester" && node "$T/signup-guide.ui.js" "$OUT" > "$OUT/guide.txt" 2>&1; stop
  grep -q "student sees the steps: false" "$OUT/guide.txt" && grep -q "JS errors: none" "$OUT/guide.txt" && echo "PASS  Owner-only sign-up steps" >> "$SUMMARY" || { echo "FAIL  Owner-only sign-up steps" >> "$SUMMARY"; sed 's/^/      /' "$OUT/guide.txt" | head -8 >> "$SUMMARY"; }
  fresh cr_lobbyui; start cr_lobbyui "tester:0000:Tester" && node "$T/lobby.ui.js" "$OUT" > "$OUT/lobbyui.txt" 2>&1; stop; record "Admin bar and lobby tools in the browser" "$OUT/lobbyui.txt"
  fresh cr_profui; start cr_profui "tester:0000:Tester" && node "$T/profiles.ui.js" "$OUT" > "$OUT/profui.txt" 2>&1; stop; record "Artist profiles in the browser" "$OUT/profui.txt"
  fresh cr_toolsui; start cr_toolsui "tester:0000:Tester" && node "$T/class-tools.ui.js" "$OUT" > "$OUT/toolsui.txt" 2>&1; stop; record "Job board, class mode, undo, paste roster, reports in the browser" "$OUT/toolsui.txt"
  fresh cr_chalui; start cr_chalui "tester:0000:Tester" && node "$T/challenges.ui.js" "$OUT" > "$OUT/chalui.txt" 2>&1; stop; record "Studio challenges in the browser" "$OUT/chalui.txt"
  fresh cr_guide2; start cr_guide2 "tester:0000:Tester" && node "$T/guide.ui.js" "$OUT" > "$OUT/guideui.txt" 2>&1; stop; record "Release Guide hidden until an owner opens it" "$OUT/guideui.txt"
  fresh cr_studioui; start cr_studioui "tester:0000:Tester" && node "$T/studio.ui.js" "$OUT" > "$OUT/studioui.txt" 2>&1; stop; record "Studio requests in the browser" "$OUT/studioui.txt"
  fresh cr_sync; start cr_sync "$OWN" && node "$T/sync-owners.ui.js" "$OUT" > "$OUT/sync.txt" 2>&1; stop; record "Change check and two-owner sync" "$OUT/sync.txt"
else echo "SKIP  Browser suites (Playwright not available)" >> "$SUMMARY"; fi
n=$(grep -ciE "error|unhandled" "$OUT/server.log" 2>/dev/null); echo "INFO  Server log errors: ${n:-0}" >> "$SUMMARY"
cat "$SUMMARY"; echo "Details: $OUT"
grep -q "^FAIL" "$SUMMARY" && exit 1 || exit 0
