#!/usr/bin/env bash
# One-shot setup for the NORSE bot on YOUR Google Cloud project.
# Run it in Google Cloud Shell (https://shell.cloud.google.com): gcloud, node and
# git are already there and you are logged in.
#
#   ./scripts/setup.sh
#
# It asks for what is missing, then: enables the APIs, creates the bot's
# service account, deploys to Cloud Run, creates ONE hourly Cloud Scheduler job
# (inside the free tier) and registers the webhook with LINE.
# Safe to re-run: values already in .env are reused, re-running redeploys.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE="${SERVICE:-norse-bot}"
REGION="${REGION:-asia-southeast1}"
JOB="${SERVICE}-tick"
ENV_FILE=".env"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v gcloud >/dev/null || die "gcloud is not installed. Open https://shell.cloud.google.com and run this there."
command -v node   >/dev/null || die "node is not installed."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || die "Node.js 20+ is required."

touch "$ENV_FILE"
getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
setenv() {
  local key="$1" val="$2" tmp
  if grep -qE "^$key=" "$ENV_FILE"; then
    tmp="$(mktemp)"; awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
  else printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"; fi
}
ask() { # ask KEY "question" [secret] [optional]
  local key="$1" q="$2" secret="${3:-}" optional="${4:-}" val
  if [ -n "$(getenv "$key")" ]; then note "$key: already set"; return; fi
  if [ -n "$secret" ]; then read -r -s -p "   $q: " val; echo; else read -r -p "   $q: " val; fi
  if [ -z "$val" ] && [ -z "$optional" ]; then die "$key is required."; fi
  [ -n "$val" ] && setenv "$key" "$val" || true
}

bold "1/6  Google Cloud project"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT" ]; then read -r -p "   Project ID: " PROJECT; fi
[ -n "$PROJECT" ] || die "No project."
gcloud config set project "$PROJECT" >/dev/null
note "project: $PROJECT"
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)"
[ "$BILLING" = "True" ] || note "⚠ Billing looks OFF. Cloud Run needs a billing account even for the free tier: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"

bold "2/6  Settings (kept in .env, never committed)"
ask LINE_CHANNEL_SECRET       "LINE channel secret (LINE Developers > your channel > Basic settings)" secret
ask LINE_CHANNEL_ACCESS_TOKEN "LINE channel access token (Messaging API tab > Issue)" secret
if [ -z "$(getenv SHEET_ID)" ]; then
  read -r -p "   Team Google Sheet URL or ID (an empty Sheet is fine): " v
  v="$(printf '%s' "$v" | sed -E 's#.*/spreadsheets/d/([^/]+).*#\1#')"
  [ -n "$v" ] || die "SHEET_ID is required."; setenv SHEET_ID "$v"
fi
ask TEAM_SEED      "Team nicknames with other spellings, admin marked, e.g. 'Jai/เจ:admin, Best/เบสท์, Bonnie/บอนนี่'"
ask GEMINI_API_KEY "Gemini API key (free: https://aistudio.google.com/apikey), Enter to skip" secret optional
ask ANTHROPIC_API_KEY "Claude API key (paid, optional), Enter to skip" secret optional
[ -n "$(getenv BOT_NAME)" ]      || setenv BOT_NAME "Norse"
[ -n "$(getenv TIMEZONE)" ]      || setenv TIMEZONE "Asia/Bangkok"
[ -n "$(getenv GEMINI_MODELS)" ] || setenv GEMINI_MODELS "gemini-3.8-flash,gemini-3.6-flash,gemini-3-flash,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite"
[ -n "$(getenv CRON_SECRET)" ]   || setenv CRON_SECRET "$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"

bold "3/6  APIs and the bot's service account"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com sheets.googleapis.com >/dev/null
SA="${SERVICE}@${PROJECT}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SERVICE" --display-name "NORSE LINE bot" >/dev/null
note "service account: $SA"
# Let you deploy Cloud Run "as" the bot's account. A new service account takes a
# little while to appear everywhere in Google Cloud, so retry for up to ~2 min.
ME="$(gcloud config get-value account 2>/dev/null)"
for i in 1 2 3 4 5 6 7 8; do
  if gcloud iam service-accounts add-iam-policy-binding "$SA" --member "user:$ME" \
      --role roles/iam.serviceAccountUser --condition None >/dev/null 2>&1; then
    note "you can deploy as the bot's account"; break
  fi
  [ "$i" = 8 ] && die "Could not give $ME the Service Account User role on $SA. Wait a minute and re-run."
  note "waiting for the new service account to be ready... ($i)"; sleep 15
done
sleep 10

bold "4/6  Deploy to Cloud Run ($REGION)"
ENV_YAML="$(mktemp --suffix .yaml)"
node -e '
  const fs = require("fs");
  const keep = ["LINE_CHANNEL_SECRET","LINE_CHANNEL_ACCESS_TOKEN","SHEET_ID","TEAM_SEED","GEMINI_API_KEY","GEMINI_MODELS",
    "ANTHROPIC_API_KEY","CLAUDE_MODEL","LLM_PROVIDER","BOT_NAME","TIMEZONE","CRON_SECRET","MORNING_HOUR","EVENING_HOUR",
    "MONDAY_HOUR","FRIDAY_HOUR","REMINDER_DAYS","OVERDUE_TAG_AFTER_DAYS","PUSH_MONTHLY_LIMIT"];
  const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  console.log(keep.filter(k => env[k]).map(k => k + ": " + JSON.stringify(env[k])).join("\n"));
' > "$ENV_YAML"
gcloud run deploy "$SERVICE" --source . --region "$REGION" --service-account "$SA" \
  --allow-unauthenticated --max-instances 1 --min-instances 0 --memory 512Mi --cpu 1 --timeout 120 \
  --env-vars-file "$ENV_YAML" --quiet
rm -f "$ENV_YAML"
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
note "URL: $URL"

bold "5/6  Hourly scheduler job (one job = free tier)"
HDR="X-Cron-Secret=$(getenv CRON_SECRET)"
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" --location "$REGION" --schedule "0 7-21 * * *" --time-zone "Asia/Bangkok" \
    --uri "$URL/cron/tick" --http-method POST --update-headers "$HDR" >/dev/null
else
  gcloud scheduler jobs create http "$JOB" --location "$REGION" --schedule "0 7-21 * * *" --time-zone "Asia/Bangkok" \
    --uri "$URL/cron/tick" --http-method POST --headers "$HDR" >/dev/null
fi
note "$JOB: every hour on the hour from 07:00 to 21:00 Bangkok time"

bold "6/6  LINE webhook and menu bar"
LINE_CHANNEL_ACCESS_TOKEN="$(getenv LINE_CHANNEL_ACCESS_TOKEN)" node scripts/set-webhook.js "$URL/webhook" || note "Set it by hand: $URL/webhook"
node scripts/rich-menu.js || note "Menu bar not set; run: node scripts/rich-menu.js"

bold "Check the Sheet connection"
if curl -fsS "$URL/health" >/dev/null 2>&1; then
  note "✓ the bot can open the Sheet and has created its tabs"
else
  note "✗ the bot cannot open the Sheet yet. Ask the Sheet owner to Share it with"
  note "    $SA"
  note "  as Editor, then open $URL/health to check."
fi

bold "Almost done. In the browser:"
note "1. LINE Developers > Messaging API: turn ON 'Use webhook' and 'Allow bot to join group chats'."
note "2. LINE Official Account Manager > Response settings: turn OFF auto-reply and greeting messages."
note "3. Share the Sheet with $SA as Editor (if not done)."
note "4. The admin adds the bot as a friend and sends:  ฉันคือ <ชื่อเล่น>"
note "5. Add the bot to the team LINE group; the admin types:  @$(getenv BOT_NAME) ใช้กลุ่มนี้"
note "6. Everyone else adds the bot as a friend and sends:  ฉันคือ <ชื่อเล่น>"
