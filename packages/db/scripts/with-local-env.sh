#!/bin/sh
# Runs a command with the local Supabase stack's URL and keys exported (local/CI only).
set -eu
eval "$(cd "$(dirname "$0")/.." && supabase status -o env 2>/dev/null | sed -En 's/^(API_URL|SERVICE_ROLE_KEY|ANON_KEY)=/export LOCAL_\1=/p')"
export SUPABASE_URL="$LOCAL_API_URL"
export SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY"
export SUPABASE_ANON_KEY="$LOCAL_ANON_KEY"
exec "$@"
