#!/usr/bin/env bash
# Starling data store — the pipeline's persistent STATE lives in Cloudflare R2
# (bucket: starling-data), not git. Ported from Ray's scripts/data-store.sh.
#
#   scripts/lib/data-store.sh pull    # fetch latest state from R2 into .starling-state/
#   scripts/lib/data-store.sh push    # publish local .starling-state/ to R2 + a dated snapshot
#   scripts/lib/data-store.sh prune [keep=14]   # trim the versions/ ladder
#
# chmod: this file must be executable-ready. After creation run
#   chmod +x scripts/lib/data-store.sh
# (the workflows invoke it as `bash scripts/lib/data-store.sh …`, so the bit is
# belt-and-suspenders, but keep it set for local use.)
#
# STATE = everything the board pipeline must remember between 3-hourly cron ticks
# (all under .starling-state/, gitignored — R2 is the source of truth, the tree
# is scratch): the seen-ledger NDJSON, the receipts ledger NDJSON, the quota
# ledger (daily call counter), the scheduler wheel position, and the permanent
# cert-verdict cache. One tarball carries the lot.
#
# Objects:
#   versions/<UTC>-<sha>/state.tar.gz   WRITE-ONCE state snapshot (.starling-state/)
#   latest/pointer.txt     tiny pointer to the current versions/ prefix — the
#                          ONLY overwritten object a pull ever has to wait on
#   latest/state.tar.gz    FROZEN legacy key (pre-pointer bootstrap fallback;
#                          no longer written — pull() keeps it as a last resort)
#   snapshots/YYYYMMDD/state.tar.gz   daily snapshot — the manual rollback ladder
#
# Retention: versions/ accumulates one small state tarball per push (≈8 pushes/
# day at the 3h cadence). `data-store.sh prune` keeps the newest N (default 14)
# and deletes the rest; an R2 lifecycle rule on the versions/ prefix would make
# it unnecessary.
#
# WRITE-ONCE RATIONALE (the whole reason this scheme exists — inherited verbatim
# from lectr): the R2 REST API GET path was observed serving a pre-overwrite
# object for 10-15+ minutes after a same-key overwrite, while the bucket LISTING
# etag flips immediately. A CI job that pulls during that window bakes STALE
# state and can silently regress (double-surface a deal it already retired, or
# re-spend a quota it already burned). So every push lands the payload under a
# UNIQUE write-once versions/ key — which reads true on its FIRST GET — and only
# the tiny latest/pointer.txt is ever overwritten. The lag wait shrinks from
# "poll a tarball for up to ~14min" to "poll a few bytes", and the payload read
# itself is authoritative immediately.
#
# Talks to the R2 REST API directly with curl — NOT `wrangler r2 object`, which
# was observed (wrangler 4.112) serving stale reads on overwritten keys. Every
# PUT is verified by comparing the etag the API returns against the local md5
# (etag == md5 for single-part uploads), so a silent store failure can't pass.
#
# Auth: CI = CLOUDFLARE_API_TOKEN (needs Account → Workers R2 Storage → Edit);
# local = wrangler's OAuth token read from its config (refresh with any wrangler
# command, e.g. `npx wrangler whoami`, if it has gone stale).
set -euo pipefail
BUCKET=starling-data
# Account id comes from the environment only — never hardcoded, so nothing
# account-identifying lives in this public repo. In CI it's the
# CLOUDFLARE_ACCOUNT_ID secret; locally, export it in your shell.
ACCOUNT=${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID (repo secret in CI, exported locally)}
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/r2/buckets/$BUCKET/objects"
STATE_DIR=.starling-state
# repo root = two levels up from scripts/lib/
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

token() {
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then echo "$CLOUDFLARE_API_TOKEN"; return; fi
  python3 - <<'EOF'
import re, glob, os
home = os.path.expanduser('~')
for p in glob.glob(home+'/Library/Preferences/.wrangler/config/*.toml') + glob.glob(home+'/.wrangler/config/*.toml') + glob.glob(home+'/.config/.wrangler/config/*.toml'):
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', open(p).read())
    if m: print(m.group(1)); raise SystemExit
raise SystemExit('no Cloudflare credentials: set CLOUDFLARE_API_TOKEN or log in with `npx wrangler login`')
EOF
}
TOKEN=$(token)

urlenc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"; }
md5_of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }

obj_get() { # key -> file; returns curl's exit, 404 leaves empty file + rc 22
  curl -sf -H "Authorization: Bearer $TOKEN" "$API/$(urlenc "$1")" -o "$2"
}
listed_etag() { # authoritative etag from the bucket listing (fresh even when GET lags)
  curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$(urlenc "$1")" \
    | python3 -c "import json,sys;objs=json.load(sys.stdin).get('result',[]);print(next((o['etag'].strip('\"') for o in objs if o.get('key')==sys.argv[1]),''))" "$1" 2>/dev/null || true
}
obj_get_fresh() { # key file — GET, and WAIT OUT the GET-lag against the listed etag.
  # For OVERWRITTEN keys only (here: latest/pointer.txt, legacy latest/state.tar.gz).
  # The API GET can serve a pre-overwrite object for 10-15+ min while the bucket
  # LISTING etag flips immediately, so the listing is the source of truth: poll
  # GET until it matches — up to DATA_FRESH_TRIES×20s (default ~14min).
  local key="$1" file="$2" want have tries=${DATA_FRESH_TRIES:-42}
  want=$(listed_etag "$key")
  local attempt=1
  while :; do
    obj_get "$key" "$file" || return $?
    have=$(md5_of "$file")
    { [ -z "$want" ] || [ "$have" = "$want" ]; } && { [ "$attempt" -gt 1 ] && echo "[data-store] $key fresh after $attempt reads (GET caught up to listed etag)"; return 0; }
    if [ "$attempt" -ge "$tries" ]; then
      echo "[data-store] WARNING: read of $key STILL STALE after $attempt reads (etag $have, bucket says $want) — using it anyway"
      return 0
    fi
    [ "$attempt" -eq 1 ] && echo "[data-store] $key GET lags bucket (have $have, want $want) — waiting for propagation…"
    attempt=$((attempt + 1))
    sleep 20
  done
}
obj_get_once() { # key file — single GET for WRITE-ONCE keys (versions/…).
  # A never-overwritten object reads fresh on the first GET (no poll loop), but
  # verify the md5 against the listed etag ONCE and fail loud on mismatch — on a
  # write-once key a mismatch means something is genuinely broken, not lagging.
  local key="$1" file="$2" want have
  obj_get "$key" "$file" || return $?
  want=$(listed_etag "$key")
  have=$(md5_of "$file")
  if [ -n "$want" ] && [ "$have" != "$want" ]; then
    echo "[data-store] ERROR: write-once $key read etag $have but bucket lists $want — refusing the read"
    return 1
  fi
}
obj_put() { # key file — upload w/ retry, then verify the returned etag against local md5.
  # Retry is safe: R2 PUTs are atomic (no partial objects) and same-key re-PUT
  # is idempotent — a transient blip must not redden the whole cron tick.
  local key="$1" file="$2" attempt
  for attempt in 1 2 3; do
    if obj_put_once "$key" "$file"; then return 0; fi
    [ "$attempt" -lt 3 ] && { echo "[data-store] PUT $key attempt $attempt failed — retrying in $((attempt*15))s"; sleep $((attempt*15)); }
  done
  echo "[data-store] PUT $key failed after 3 attempts"
  return 1
}
obj_put_once() { # key file — single upload + etag verify
  local key="$1" file="$2" enc resp up etag
  enc=$(urlenc "$key")
  resp=$(curl -sf -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" --data-binary "@$file" "$API/$enc") \
    || { echo "[data-store] PUT $key failed"; return 1; }
  echo "$resp" | grep -q '"success": *true' || { echo "[data-store] PUT $key rejected: $(echo "$resp" | head -c 200)"; return 1; }
  up=$(md5_of "$file")
  etag=$(echo "$resp" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result',{}).get('etag','').strip('\"'))" 2>/dev/null || true)
  if [ -n "$etag" ] && [ "$etag" != "$up" ]; then
    echo "[data-store] ETAG MISMATCH on $key (local $up, stored $etag) — store is inconsistent"; return 1
  fi
  echo "[data-store] $key ✓ ($(wc -c < "$file" | tr -d ' ') bytes, etag ${etag:-unverified})"
}
obj_delete() { # key — prune only; a failed delete is loud but the caller decides
  curl -sf -X DELETE -H "Authorization: Bearer $TOKEN" "$API/$(urlenc "$1")" -o /dev/null \
    || { echo "[data-store] DELETE $1 failed"; return 1; }
  echo "[data-store] deleted $1"
}
list_keys() { # prefix -> matching keys, one per line (paginates: versions/ grows over time)
  local enc cursor="" page
  enc=$(urlenc "$1")
  while :; do
    page=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$enc&per_page=1000${cursor:+&cursor=$cursor}") || return 1
    echo "$page" | python3 -c "import json,sys;[print(o['key']) for o in json.load(sys.stdin).get('result',[])]"
    cursor=$(echo "$page" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result_info',{}).get('cursor') or '')" 2>/dev/null || true)
    [ -n "$cursor" ] || break
  done
}

install_state() { # tarball -> .starling-state/  (atomic-ish: extract then swap)
  rm -rf "$STATE_DIR" && mkdir -p "$STATE_DIR"
  tar -xzf "$1" -C "$STATE_DIR"
  echo "[data-store] state installed into $STATE_DIR/"
}

pull() {
  # Route 1 — pointer → write-once version (the fast path). The pointer is the
  # ONLY overwritten object read here, so it alone gets the freshness poll (a
  # few bytes). The versioned payload it names is write-once: first GET is
  # authoritative. In CI the working tree is a fresh checkout with no local
  # state, so pull simply installs whatever R2 holds — R2 is the source of truth.
  local ver=""
  if obj_get_fresh "latest/pointer.txt" "$TMP/pointer.txt" && [ -s "$TMP/pointer.txt" ]; then
    ver=$(tr -d '[:space:]' < "$TMP/pointer.txt")
    case "$ver" in
      versions/*) ;;
      *) echo "[data-store] pointer content looks wrong ('$ver') — falling back to legacy key"; ver="" ;;
    esac
  fi
  if [ -n "$ver" ]; then
    if obj_get_once "$ver/state.tar.gz" "$TMP/state.tar.gz"; then
      echo "[data-store] pulling $ver (write-once key — no GET-lag wait)"
      install_state "$TMP/state.tar.gz"
      return
    fi
    # A pointer naming an unreadable version should never happen (push writes the
    # payload BEFORE the pointer). Fall through to the legacy key / bootstrap.
    echo "[data-store] WARNING: pointer names $ver but its payload is unreadable — falling back"
  fi
  # Route 2 — LEGACY latest/state.tar.gz: pre-pointer bootstrap or a broken
  # versioned read. Overwritten key → the full GET-lag poll applies.
  if obj_get_fresh "latest/state.tar.gz" "$TMP/state.tar.gz" && [ -s "$TMP/state.tar.gz" ]; then
    install_state "$TMP/state.tar.gz"
    return
  fi
  # Route 3 — BOOTSTRAP. Unlike lectr's corpus (fatal if absent), Starling's
  # state legitimately starts empty: the very first run has no seen-ledger, no
  # receipts, no quota spent. Keep any existing local state; otherwise seed an
  # empty dir and let the pipeline populate it. Non-fatal by design.
  if [ -d "$STATE_DIR" ] && [ -n "$(ls -A "$STATE_DIR" 2>/dev/null)" ]; then
    echo "[data-store] no state in R2 — keeping existing local $STATE_DIR/"
  else
    mkdir -p "$STATE_DIR"
    echo "[data-store] no state in R2 and none local — bootstrapping empty $STATE_DIR/ (first run)"
  fi
}

push() {
  mkdir -p "$STATE_DIR"
  # -C into the dir so the tarball holds bare member paths (seen.ndjson, …), not
  # the .starling-state/ prefix — install_state extracts straight back into it.
  tar -czf "$TMP/state.tar.gz" -C "$STATE_DIR" .
  # WRITE-ONCE versioned key — kills the GET-lag at the root (see header). Prefix:
  # UTC stamp (sorts chronologically, prune relies on it) + short sha (or run id /
  # random) for uniqueness within a second.
  local sha ver day
  sha=$(git rev-parse --short HEAD 2>/dev/null || echo "${GITHUB_RUN_ID:-$RANDOM$RANDOM}")
  ver="versions/$(date -u +%Y%m%dT%H%M%SZ)-$sha"
  obj_put "$ver/state.tar.gz" "$TMP/state.tar.gz"
  # Pointer LAST — a reader can only ever see a version whose payload is already
  # fully stored and etag-verified above.
  printf '%s' "$ver" > "$TMP/pointer.txt"
  obj_put "latest/pointer.txt" "$TMP/pointer.txt"
  # dated snapshot — the manual rollback ladder.
  day=$(date -u +%Y%m%d)
  obj_put "snapshots/$day/state.tar.gz" "$TMP/state.tar.gz"
  echo "[data-store] pushed $ver + snapshot $day"
}

prune() { # keep the newest N versions/ prefixes (default 14), delete the rest.
  # Prefixes start with a UTC timestamp, so plain lexicographic sort IS
  # chronological order. An R2 lifecycle rule on versions/ would replace this.
  local keep="${1:-14}" keys dirs total doomed d k
  keys=$(list_keys "versions/") || { echo "[data-store] prune: listing failed"; exit 1; }
  [ -n "$keys" ] || { echo "[data-store] prune: nothing under versions/ yet"; return 0; }
  dirs=$(echo "$keys" | awk -F/ 'NF>=3{print $1"/"$2}' | sort -u)
  total=$(echo "$dirs" | wc -l | tr -d ' ')
  if [ "$total" -le "$keep" ]; then
    echo "[data-store] prune: $total version(s) ≤ keep=$keep — nothing to do"
    return 0
  fi
  doomed=$(echo "$dirs" | head -n $((total - keep)))
  echo "[data-store] prune: $total versions, keeping newest $keep, deleting $((total - keep))"
  for d in $doomed; do
    for k in $(echo "$keys" | grep "^$d/"); do
      obj_delete "$k"   # a failed delete aborts (set -e): better loud than a silent half-prune
    done
  done
}

case "${1:-}" in
  pull)  pull ;;
  push)  push ;;
  prune) prune "${2:-14}" ;;
  *) echo "usage: $0 pull|push|prune [keep=14]"; exit 1 ;;
esac
