#!/usr/bin/env bash
# collect-jenkins-log.sh
#
# Collects the Jenkins system log (jenkins.log) in two ways:
#   1. Via the Jenkins REST API  (/log/all/text)          [default — works remotely]
#   2. By watching the log file on disk and copying it as it rotates  [local host only]
#
# Usage:
#   ./collect-jenkins-log.sh [api|file|both|once]
#
#   api  — polls a remote (or local) Jenkins over HTTP; no host access needed (default)
#   once — fetches the current log a single time, writes it to a timestamped file, and exits
#   file — watches jenkins.log on the local filesystem; only useful when running ON
#           the Jenkins host itself
#   both — runs both in parallel; only useful when the script runs on the Jenkins host
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
#   2. .env.gpg  — GPG-encrypted env file (decrypted into memory, never written to disk)
#   3. .env      — plaintext fallback (must be chmod 600, never committed)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_FILE_GPG="${SCRIPT_DIR}/.env.gpg"

_load_env_vars() {
    # Parse KEY=VALUE lines from stdin into the environment
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" =~ ^[[:space:]]*# ]] && continue   # skip comments
        [[ "$line" =~ ^[[:space:]]*$ ]] && continue   # skip blank lines
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local_key="${BASH_REMATCH[1]}"
            local_val="${BASH_REMATCH[2]}"
            # Only set if not already set AND non-empty in the environment
            if [[ -z "${!local_key:-}" ]]; then
                export "$local_key"="$local_val"
            fi
        fi
    done
}

if [[ -f "$ENV_FILE_GPG" ]]; then
    # Decrypt into memory — no temp file written to disk
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
# Defaults (applied after .env so the file can override them)
# ---------------------------------------------------------------------------
# Strip any trailing slash from JENKINS_URL so paths compose cleanly
JENKINS_URL="${JENKINS_URL:-http://localhost:8080}"
JENKINS_URL="${JENKINS_URL%/}"
JENKINS_USER="${JENKINS_USER:-}"
JENKINS_TOKEN="${JENKINS_TOKEN:-}"
JENKINS_LOG_FILE="${JENKINS_LOG_FILE:-/var/log/jenkins/jenkins.log}"
# Path to the log recorder page (relative to JENKINS_URL).
# Modern Jenkins (2.5xx+) uses /manage/log/<name>; older installs use /log/<name>/text.
# Set LOG_RECORDER_PATH to the plain-text endpoint if your Jenkins exposes one,
# or leave as the HTML page path and the script will extract log entries from the HTML.
LOG_RECORDER_PATH="${LOG_RECORDER_PATH:-/manage/log/all}"
OUTPUT_DIR="${OUTPUT_DIR:-./jenkins-logs}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

MODE="${1:-api}"
# Output filename for once mode (defaults to a timestamped file in OUTPUT_DIR)
ONCE_OUTPUT="${ONCE_OUTPUT:-}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

die() { echo "ERROR: $*" >&2; exit 1; }

require() {
    for cmd in "$@"; do
        command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is required but not found in PATH"
    done
}

# Timestamp used to name snapshot files
timestamp() { date '+%Y%m%d_%H%M%S'; }

# ---------------------------------------------------------------------------
# API mode — fetches log entries from the Jenkins log recorder page.
#
# Supports two endpoint styles automatically:
#   plain-text  — if LOG_RECORDER_PATH returns plain text (e.g. /log/all/text),
#                 new bytes are fetched incrementally using the Range header.
#   HTML page   — if the endpoint returns HTML (e.g. /manage/log/all on Jenkins
#                 2.5xx+), log entries are extracted from <pre class="logrecord-*">
#                 elements and appended as plain text.
# ---------------------------------------------------------------------------
run_api_mode() {
    require curl

    [[ -z "$JENKINS_USER" ]]  && die "JENKINS_USER is not set"
    [[ -z "$JENKINS_TOKEN" ]] && die "JENKINS_TOKEN is not set"

    local api_url="${JENKINS_URL}${LOG_RECORDER_PATH}"
    local out_file="${OUTPUT_DIR}/jenkins-api.log"
    local byte_offset=0
    local mode_detected=""   # "text" or "html"

    mkdir -p "$OUTPUT_DIR"
    log "API mode: polling ${api_url} every ${POLL_INTERVAL}s → ${out_file}"

    while true; do
        local http_code
        # Write status code to its own file so it never mixes with the body
        curl -sS \
            --user "${JENKINS_USER}:${JENKINS_TOKEN}" \
            -H "Range: bytes=${byte_offset}-" \
            -w "%{http_code}" \
            -o /tmp/jenkins_log_chunk \
            "${api_url}" > /tmp/jenkins_log_status 2>/dev/null || true
        http_code=$(cat /tmp/jenkins_log_status)
        [[ "$http_code" =~ ^[0-9]+$ ]] || http_code="000"

        case "$http_code" in
            200|206)
                # Auto-detect whether the response is plain text or HTML
                if [[ -z "$mode_detected" ]]; then
                    if grep -q '<html' /tmp/jenkins_log_chunk 2>/dev/null; then
                        mode_detected="html"
                        log "API: detected HTML response — extracting log entries from page"
                        # HTML pages are not incrementally fetchable with Range; reset offset
                        byte_offset=0
                    else
                        mode_detected="text"
                        log "API: detected plain-text response — using incremental Range fetch"
                    fi
                fi

                if [[ "$mode_detected" == "html" ]]; then
                    # Extract log entries from the HTML and write as plain text.
                    # Each entry is in <pre class="logrecord-metadata">...</pre>
                    # followed by a message block. Capture timestamp/level/logger + message.
                    local new_entries
                    new_entries=$(
                        sed 's/<[^>]*>//g' /tmp/jenkins_log_chunk \
                        | sed '/^[[:space:]]*$/d' \
                        | grep -A1 '^[A-Z][a-z][a-z] [0-9]'
                    )
                    local entry_hash
                    entry_hash=$(echo "$new_entries" | md5sum | cut -d' ' -f1)
                    local hash_file="${OUTPUT_DIR}/.last_html_hash"
                    local last_hash=""
                    [[ -f "$hash_file" ]] && last_hash=$(cat "$hash_file")

                    if [[ "$entry_hash" != "$last_hash" ]]; then
                        # Page changed — overwrite with full current content
                        # (HTML page always shows a rolling window, not cumulative)
                        echo "$new_entries" > "${out_file}.tmp"
                        mv "${out_file}.tmp" "$out_file"
                        echo "$entry_hash" > "$hash_file"
                        local line_count
                        line_count=$(wc -l < "$out_file")
                        log "API: page updated, wrote ${line_count} lines → ${out_file}"
                    fi
                else
                    # Plain text — append new bytes
                    local chunk_size
                    chunk_size=$(wc -c < /tmp/jenkins_log_chunk)
                    if (( chunk_size > 0 )); then
                        cat /tmp/jenkins_log_chunk >> "$out_file"
                        byte_offset=$(( byte_offset + chunk_size ))
                        log "API: appended ${chunk_size} bytes (total offset: ${byte_offset})"
                    fi
                fi
                ;;
            416)
                # 416 Range Not Satisfiable = no new data yet (plain-text mode only)
                ;;
            000)
                log "API: connection failed, will retry in ${POLL_INTERVAL}s"
                ;;
            *)
                log "API: unexpected HTTP ${http_code}, will retry in ${POLL_INTERVAL}s"
                ;;
        esac

        sleep "$POLL_INTERVAL"
    done
}

# ---------------------------------------------------------------------------
# File mode — watches jenkins.log on disk; copies the active file and each
# rotated file (jenkins.log.1, jenkins.log.2.gz, etc.) as they appear
# ---------------------------------------------------------------------------
run_file_mode() {
    local log_dir
    log_dir=$(dirname "$JENKINS_LOG_FILE")
    local log_name
    log_name=$(basename "$JENKINS_LOG_FILE")

    mkdir -p "$OUTPUT_DIR"

    # inotifywait is ideal; fall back to a stat-based poll loop
    if command -v inotifywait >/dev/null 2>&1; then
        log "File mode (inotifywait): watching ${log_dir} for ${log_name} rotation events"
        _file_mode_inotify "$log_dir" "$log_name"
    else
        log "File mode (polling): inotifywait not found, falling back to stat-based poll every ${POLL_INTERVAL}s"
        _file_mode_poll "$log_dir" "$log_name"
    fi
}

_file_mode_inotify() {
    local log_dir="$1" log_name="$2"
    # Track the inode of the current log so we detect rotation
    local last_inode=""

    inotifywait -m -q -e close_write -e moved_to -e create \
        --format '%e %f' "$log_dir" |
    while read -r event file; do
        local full_path="${log_dir}/${file}"

        # Active log updated — take a snapshot
        if [[ "$file" == "$log_name" && "$event" == *CLOSE_WRITE* ]]; then
            local cur_inode
            cur_inode=$(stat -c '%i' "$full_path" 2>/dev/null || echo "")
            if [[ "$cur_inode" != "$last_inode" ]]; then
                # Inode changed = rotation just happened; copy the fresh file
                local dest="${OUTPUT_DIR}/${log_name}_rotated_$(timestamp)"
                cp "$full_path" "$dest"
                log "File: rotation detected, copied → ${dest}"
                last_inode="$cur_inode"
            else
                # Same inode = normal write; copy current state
                local dest="${OUTPUT_DIR}/${log_name}_$(timestamp)"
                cp "$full_path" "$dest"
                log "File: updated, snapshot → ${dest}"
            fi
        fi

        # Rotated file appeared (jenkins.log.1, jenkins.log.2.gz, etc.)
        if [[ "$file" == "${log_name}".* ]]; then
            local dest="${OUTPUT_DIR}/${file}_$(timestamp)"
            cp "$full_path" "$dest" 2>/dev/null && \
                log "File: rotated file copied → ${dest}" || true
        fi
    done
}

_file_mode_poll() {
    local log_dir="$1" log_name="$2"
    local full_path="${log_dir}/${log_name}"
    local last_inode="" last_size=0

    while true; do
        if [[ -f "$full_path" ]]; then
            local cur_inode cur_size
            cur_inode=$(stat -c '%i' "$full_path")
            cur_size=$(stat -c '%s'  "$full_path")

            if [[ "$cur_inode" != "$last_inode" ]]; then
                # New inode = rotation
                local dest="${OUTPUT_DIR}/${log_name}_rotated_$(timestamp)"
                cp "$full_path" "$dest"
                log "File: rotation detected, copied → ${dest}"
                last_inode="$cur_inode"
                last_size="$cur_size"
            elif (( cur_size != last_size )); then
                # Same inode, size changed = new content
                local dest="${OUTPUT_DIR}/${log_name}_$(timestamp)"
                cp "$full_path" "$dest"
                log "File: size changed (${last_size}→${cur_size}), snapshot → ${dest}"
                last_size="$cur_size"
            fi
        else
            log "File: ${full_path} not found, waiting..."
        fi

        # Also pick up any rotated files that appeared since last poll
        for rotated in "${log_dir}/${log_name}".*; do
            [[ -f "$rotated" ]] || continue
            local rname; rname=$(basename "$rotated")
            local marker="${OUTPUT_DIR}/.seen_${rname}"
            if [[ ! -f "$marker" ]]; then
                local dest="${OUTPUT_DIR}/${rname}_$(timestamp)"
                cp "$rotated" "$dest"
                touch "$marker"
                log "File: rotated file copied → ${dest}"
            fi
        done

        sleep "$POLL_INTERVAL"
    done
}

# ---------------------------------------------------------------------------
# Once mode — single fetch of the current log, then exit
# ---------------------------------------------------------------------------
run_once_mode() {
    require curl

    [[ -z "$JENKINS_USER" ]]  && die "JENKINS_USER is not set"
    [[ -z "$JENKINS_TOKEN" ]] && die "JENKINS_TOKEN is not set"

    local api_url="${JENKINS_URL}${LOG_RECORDER_PATH}"

    # Determine output file: explicit ONCE_OUTPUT, or a timestamped file
    local out_file
    if [[ -n "$ONCE_OUTPUT" ]]; then
        out_file="$ONCE_OUTPUT"
    else
        mkdir -p "$OUTPUT_DIR"
        out_file="${OUTPUT_DIR}/jenkins-$(timestamp).log"
    fi

    log "Once mode: fetching ${api_url} → ${out_file}"

    curl -sS \
        --user "${JENKINS_USER}:${JENKINS_TOKEN}" \
        -w "%{http_code}" \
        -o /tmp/jenkins_log_chunk \
        "${api_url}" > /tmp/jenkins_log_status 2>/dev/null || true

    local http_code
    http_code=$(cat /tmp/jenkins_log_status)
    [[ "$http_code" =~ ^[0-9]+$ ]] || http_code="000"

    case "$http_code" in
        200|206)
            if grep -q '<html' /tmp/jenkins_log_chunk 2>/dev/null; then
                # HTML page — strip tags and blank lines
                sed 's/<[^>]*>//g' /tmp/jenkins_log_chunk \
                    | sed '/^[[:space:]]*$/d' \
                    | grep -A1 '^[A-Z][a-z][a-z] [0-9]' \
                    > "$out_file"
            else
                # Plain text — write as-is
                cp /tmp/jenkins_log_chunk "$out_file"
            fi
            local line_count
            line_count=$(wc -l < "$out_file")
            log "Once mode: wrote ${line_count} lines → ${out_file}"
            ;;
        000)
            die "Connection failed — check JENKINS_URL (${JENKINS_URL})"
            ;;
        401|403)
            die "HTTP ${http_code} — check JENKINS_USER and JENKINS_TOKEN"
            ;;
        *)
            die "HTTP ${http_code} from ${api_url} — check LOG_RECORDER_PATH"
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"
log "Starting collect-jenkins-log.sh (mode=${MODE})"

case "$MODE" in
    api)
        run_api_mode
        ;;
    once)
        run_once_mode
        ;;
    file)
        run_file_mode
        ;;
    both)
        run_api_mode  &
        API_PID=$!
        run_file_mode &
        FILE_PID=$!
        log "Running both modes (api PID=${API_PID}, file PID=${FILE_PID})"
        # Forward SIGTERM/SIGINT to children
        trap 'kill $API_PID $FILE_PID 2>/dev/null; exit 0' SIGTERM SIGINT
        wait
        ;;
    *)
        die "Unknown mode '${MODE}'. Use: api | once | file | both"
        ;;
esac
