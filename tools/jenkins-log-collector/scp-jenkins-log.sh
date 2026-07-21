#!/usr/bin/env bash
# scp-jenkins-log.sh
#
# Copies the Jenkins system log from a remote server to a local output directory
# using SCP or SFTP. Designed as a companion to collect-jenkins-log.sh which
# uses the Jenkins REST API.
#
# Usage:
#   ./scp-jenkins-log.sh [once|watch]
#
#   once  — copy the current log file once, then exit (default)
#   watch — poll the remote log repeatedly, copying when the file changes
#
# Configuration is loaded from a .env file in the same directory as this
# script. Copy .env.example to .env and fill in your values.
# Any variable already set in the environment takes precedence over .env.

set -euo pipefail

# ---------------------------------------------------------------------------
# Load .env (if present) — existing env vars are NOT overwritten.
#
# Secret sources are tried in this order (first non-empty value wins):
#   1. Variables already set in the shell environment (e.g. CI/CD secrets)
#   2. .env.gpg  — GPG-encrypted env file (decrypted into memory, never to disk)
#   3. .env      — plaintext fallback (chmod 600, never commit)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_FILE_GPG="${SCRIPT_DIR}/.env.gpg"

_load_env_vars() {
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local_key="${BASH_REMATCH[1]}"
            local_val="${BASH_REMATCH[2]}"
            if [[ -z "${!local_key:-}" ]]; then
                export "$local_key"="$local_val"
            fi
        fi
    done
}

if [[ -f "$ENV_FILE_GPG" ]]; then
    if command -v gpg >/dev/null 2>&1; then
        gpg --quiet --batch --decrypt "$ENV_FILE_GPG" 2>/dev/null | _load_env_vars \
            || echo "WARNING: GPG decryption of .env.gpg failed — falling back to .env" >&2
    else
        echo "WARNING: .env.gpg found but gpg is not installed — falling back to .env" >&2
    fi
fi

if [[ -f "$ENV_FILE" ]]; then
    _load_env_vars < "$ENV_FILE"
fi

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
# Remote host connection
SSH_HOST="${SSH_HOST:-}"                                      # required
SSH_USER="${SSH_USER:-jenkins}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_rsa}"                     # private key path

# Path to jenkins.log on the remote host
REMOTE_LOG_FILE="${REMOTE_LOG_FILE:-/var/log/jenkins/jenkins.log}"

# Local output directory
OUTPUT_DIR="${OUTPUT_DIR:-./jenkins-logs}"

# Seconds between polls in watch mode
POLL_INTERVAL="${POLL_INTERVAL:-30}"

# Optional: explicit output filename for once mode
# Defaults to a timestamped copy in OUTPUT_DIR
ONCE_OUTPUT="${ONCE_OUTPUT:-}"

MODE="${1:-once}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }
timestamp() { date '+%Y%m%d_%H%M%S'; }

require() {
    for cmd in "$@"; do
        command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is required but not found in PATH"
    done
}

validate_config() {
    [[ -z "$SSH_HOST" ]] && die "SSH_HOST is not set"
    [[ -f "$SSH_KEY" ]]  || die "SSH key not found: ${SSH_KEY}"
}

# Common SSH/SCP options — BatchMode prevents interactive prompts, which would
# hang in unattended use; StrictHostKeyChecking=accept-new trusts new hosts
# automatically on first connect but rejects changed keys thereafter.
ssh_opts=(
    -i "$SSH_KEY"
    -p "$SSH_PORT"
    -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new
    -o ConnectTimeout=15
    -o ServerAliveInterval=30
)

# ---------------------------------------------------------------------------
# Core copy function — used by both modes
# ---------------------------------------------------------------------------
copy_log() {
    local dest="$1"
    local tmp="${dest}.tmp"

    scp "${ssh_opts[@]/#/-P}" \
        "${SSH_USER}@${SSH_HOST}:${REMOTE_LOG_FILE}" \
        "$tmp" 2>/dev/null && mv "$tmp" "$dest" || {
        rm -f "$tmp"
        return 1
    }
}

# SCP uses -P for port (not -p like SSH); rebuild opts specifically for scp
scp_opts=(
    -i "$SSH_KEY"
    -P "$SSH_PORT"
    -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new
    -o ConnectTimeout=15
    -o ServerAliveInterval=30
)

# ---------------------------------------------------------------------------
# Once mode — copy the log once and exit
# ---------------------------------------------------------------------------
run_once_mode() {
    require scp

    local dest
    if [[ -n "$ONCE_OUTPUT" ]]; then
        dest="$ONCE_OUTPUT"
        mkdir -p "$(dirname "$dest")"
    else
        mkdir -p "$OUTPUT_DIR"
        dest="${OUTPUT_DIR}/jenkins-$(timestamp).log"
    fi

    log "Once: copying ${SSH_USER}@${SSH_HOST}:${REMOTE_LOG_FILE} → ${dest}"

    scp "${scp_opts[@]}" \
        "${SSH_USER}@${SSH_HOST}:${REMOTE_LOG_FILE}" \
        "${dest}.tmp" \
        && mv "${dest}.tmp" "$dest" \
        || { rm -f "${dest}.tmp"; die "SCP failed — check SSH_HOST, SSH_USER, SSH_KEY, and REMOTE_LOG_FILE"; }

    local size
    size=$(wc -c < "$dest")
    log "Once: done — ${size} bytes → ${dest}"
}

# ---------------------------------------------------------------------------
# Watch mode — poll the remote file, copy when it changes (by size or mtime)
# ---------------------------------------------------------------------------
run_watch_mode() {
    require scp ssh

    mkdir -p "$OUTPUT_DIR"
    local last_size="-1"
    local last_mtime=""

    log "Watch: polling ${SSH_USER}@${SSH_HOST}:${REMOTE_LOG_FILE} every ${POLL_INTERVAL}s"

    while true; do
        # Get remote file size and mtime in one SSH call to minimise round-trips
        local stat_out
        stat_out=$(ssh "${ssh_opts[@]}" \
            "${SSH_USER}@${SSH_HOST}" \
            "stat -c '%s %Y' '${REMOTE_LOG_FILE}' 2>/dev/null || echo 'error'" \
            2>/dev/null) || stat_out="error"

        if [[ "$stat_out" == "error" || -z "$stat_out" ]]; then
            log "Watch: could not stat remote file, will retry in ${POLL_INTERVAL}s"
            sleep "$POLL_INTERVAL"
            continue
        fi

        local cur_size cur_mtime
        cur_size="${stat_out%% *}"
        cur_mtime="${stat_out##* }"

        if [[ "$cur_size" != "$last_size" || "$cur_mtime" != "$last_mtime" ]]; then
            local dest="${OUTPUT_DIR}/jenkins-$(timestamp).log"
            log "Watch: change detected (size ${last_size}→${cur_size}), copying → ${dest}"

            scp "${scp_opts[@]}" \
                "${SSH_USER}@${SSH_HOST}:${REMOTE_LOG_FILE}" \
                "${dest}.tmp" \
                && mv "${dest}.tmp" "$dest" \
                || { rm -f "${dest}.tmp"; log "Watch: SCP failed, will retry in ${POLL_INTERVAL}s"; sleep "$POLL_INTERVAL"; continue; }

            local size
            size=$(wc -c < "$dest")
            log "Watch: copied ${size} bytes → ${dest}"
            last_size="$cur_size"
            last_mtime="$cur_mtime"
        fi

        sleep "$POLL_INTERVAL"
    done
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"
validate_config
log "Starting scp-jenkins-log.sh (mode=${MODE})"

case "$MODE" in
    once)
        run_once_mode
        ;;
    watch)
        run_watch_mode
        ;;
    *)
        die "Unknown mode '${MODE}'. Use: once | watch"
        ;;
esac
