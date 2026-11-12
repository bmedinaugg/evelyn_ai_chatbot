#!/bin/sh
# One command to click through the whole chatbot locally (see docs/TESTING.md).
#
#   pnpm dev:local                 real Claude answers (ANTHROPIC_API_KEY from .env; ~$0.002/question)
#   FAKE_AI=1 pnpm dev:local       canned answers, no Claude spend
#   FAQ=fixtures pnpm dev:local    reseed the synthetic FAQ set (needed before evals)
#   FAQ=real pnpm dev:local        sync the real public TrainMore articles (Freshdesk keys in .env)
#
# Always local and safe: mock Magicline with synthetic profiles (never real customer data), login
# codes and tickets/leads are printed to the log instead of being emailed or sent to Freshdesk.
# Stops everything on Ctrl+C.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOGS="$ROOT/.dev-local"
mkdir -p "$LOGS"
cd "$ROOT"

API_PORT=8787
WIDGET_PORT=5173
DEMO_PORT=8090
MOCK_PORT=4010
MOCK_KEYS='cross:dev-cross,1001:dev-1001,1002:dev-1002'

for port in $API_PORT $WIDGET_PORT $DEMO_PORT $MOCK_PORT; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop whatever runs there first." >&2
    exit 1
  fi
done

# Value of a key in .env without inline comments; empty when unset.
env_value() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/[[:space:]]#.*//; s/^[[:space:]]*//; s/[[:space:]]*$//'
}

PIDS=""
cleanup() {
  for pid in $PIDS; do kill "$pid" 2>/dev/null || true; done
  printf "\nStopped. Logs are in %s\n" "$LOGS"
}
trap cleanup EXIT INT TERM

wait_for() {
  i=0
  until curl -s -o /dev/null "$1"; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then echo "Timed out waiting for $1 (see $LOGS)" >&2; exit 1; fi
    sleep 1
  done
}

echo "1/5 Database (Supabase, Docker)"
(cd packages/db && supabase status >/dev/null 2>&1) || pnpm --filter @trainmore/db db:start >"$LOGS/db.log" 2>&1
DB() { sh "$ROOT/packages/db/scripts/with-local-env.sh" env NODE_ENV=development APP_ENV=local AWS_REGION=eu-west-1 "$@"; }
ACTIVE=$(docker exec supabase_db_trainmore-chatbot psql -U postgres -d postgres -Atc \
  "select count(*) from faq_articles where deleted_at is null" 2>/dev/null || echo 0)
FAQ_MODE=${FAQ:-}
[ -z "$FAQ_MODE" ] && [ "$ACTIVE" = "0" ] && FAQ_MODE=fixtures
case "$FAQ_MODE" in
  fixtures)
    DB pnpm --filter @trainmore/worker exec tsx src/main.ts seed-faq-fixtures >"$LOGS/faq.log" 2>&1
    echo "    FAQ: synthetic fixtures" ;;
  real)
    (cd apps/worker && DB node --env-file-if-exists=../../.env --import tsx src/main.ts sync-faq --allow-mass-change) >"$LOGS/faq.log" 2>&1
    echo "    FAQ: real public TrainMore articles" ;;
  *) echo "    FAQ: keeping the $ACTIVE articles already stored" ;;
esac
DB env FRESHDESK_FAKE=1 pnpm --filter @trainmore/worker exec tsx src/main.ts sync-ticket-topics >"$LOGS/topics.log" 2>&1 || true

echo "2/5 Mock Magicline (synthetic profiles)"
MOCK_MAGICLINE_KEYS=$MOCK_KEYS PORT=$MOCK_PORT pnpm --filter @trainmore/mock-magicline start >"$LOGS/mock-magicline.log" 2>&1 &
PIDS="$PIDS $!"
wait_for "http://localhost:$MOCK_PORT/v1/studios/information"

echo "3/5 API (port $API_PORT)"
OTP_SECRET=$(env_value OTP_HMAC_SECRET)
[ "${#OTP_SECRET}" -ge 32 ] || OTP_SECRET=$(openssl rand -hex 32)
CONTACT_URL=$(env_value SUPPORT_CONTACT_URL)
[ -n "$CONTACT_URL" ] || CONTACT_URL=https://www.support.trainmore.com/nl/support/tickets/new
(
  cd apps/api
  DB env \
    LOG_LEVEL=info API_PORT=$API_PORT TRUST_PROXY_HOPS=0 \
    WIDGET_ALLOWED_ORIGINS=http://localhost:$WIDGET_PORT SUPPORT_CONTACT_URL="$CONTACT_URL" \
    OTP_HMAC_SECRET="$OTP_SECRET" TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
    MAGICLINE_USE_MOCK=true MAGICLINE_BASE_URL=http://localhost:$MOCK_PORT MOCK_MAGICLINE_KEYS=$MOCK_KEYS \
    FRESHDESK_FAKE=1 CHAT_FAKE_ANSWERER="${FAKE_AI:-0}" \
    node --env-file-if-exists=../../.env --import tsx src/main.ts
) >"$LOGS/api.log" 2>&1 &
PIDS="$PIDS $!"
wait_for "http://localhost:$API_PORT/health"

echo "4/5 Widget (production build, port $WIDGET_PORT)"
(
  cd apps/widget
  VITE_API_BASE_URL=http://localhost:$API_PORT VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
    VITE_PRIVACY_URL=https://www.trainmore.nl/privacy pnpm build >"$LOGS/widget-build.log" 2>&1
  pnpm exec vite preview --port $WIDGET_PORT --strictPort
) >"$LOGS/widget.log" 2>&1 &
PIDS="$PIDS $!"
wait_for "http://localhost:$WIDGET_PORT/loader.js"

echo "5/5 Demo help-portal page (port $DEMO_PORT)"
python3 -m http.server $DEMO_PORT --bind 127.0.0.1 --directory apps/widget/demo >"$LOGS/demo.log" 2>&1 &
PIDS="$PIDS $!"
wait_for "http://127.0.0.1:$DEMO_PORT/nl/support/home/"

cat <<EOF

Ready:
  Dutch   http://127.0.0.1:$DEMO_PORT/nl/support/home/
  English http://127.0.0.1:$DEMO_PORT/en/support/home/

  Answers:      $( [ "${FAKE_AI:-0}" = 1 ] && echo "canned (FAKE_AI=1)" || echo "real Claude" )
  Test logins:  member.single@example.com, multi@example.com, former@example.com, prospect@example.com
  Login codes, tickets, notes and leads are printed here:
EOF
tail -f "$LOGS/api.log" | grep --line-buffered -E '^\[local|^  '
