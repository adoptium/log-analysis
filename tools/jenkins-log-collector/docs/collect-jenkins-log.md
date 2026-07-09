# collect-jenkins-log.sh — API-based log collector

Collects the Jenkins system log by polling the Jenkins REST API over HTTPS.
No SSH or filesystem access to the Jenkins host is required.

---

## Modes

| Mode | Behaviour |
|------|-----------|
| `api` | Polls the log recorder endpoint continuously, appending new content to a local file **(default)** |
| `once` | Fetches the current log a single time, writes it to a timestamped file, and exits |
| `file` | Watches `jenkins.log` on the local filesystem — only useful when running directly on the Jenkins host |
| `both` | Runs `api` and `file` in parallel — only useful when running on the Jenkins host |

For remote collection, `api` and `once` are the relevant modes.

---

## Requirements

| Dependency | Required for | Notes |
|------------|-------------|-------|
| `bash` ≥ 4 | All modes | |
| `curl` | `api`, `once` modes | |
| `inotifywait` | `file` mode (optional) | From `inotify-tools`. Falls back to stat-based polling if absent. |

Install `inotify-tools` on Debian/Ubuntu:
```bash
sudo apt-get install inotify-tools
```

On RHEL/Fedora:
```bash
sudo dnf install inotify-tools
```

---

## Quick Start

```bash
# 1. Copy and fill in the shared config
cp ../dot.env.example ../.env
$EDITOR ../.env

# 2. Make executable (first time only)
chmod +x collect-jenkins-log.sh

# 3. Run
./collect-jenkins-log.sh        # continuous API polling (default)
./collect-jenkins-log.sh once   # single fetch, then exit
```

---

## Configuration

All variables are set in the shared `.env` file one directory up.

| Variable | Default | Description |
|----------|---------|-------------|
| `JENKINS_URL` | `http://localhost:8080` | Base URL of your Jenkins instance |
| `JENKINS_USER` | *(required)* | Jenkins username with *Overall/Read* and *System log/View* permissions |
| `JENKINS_TOKEN` | *(required)* | Jenkins API token for `JENKINS_USER` |
| `LOG_RECORDER_PATH` | `/manage/log/all` | Path to the log recorder page relative to `JENKINS_URL`. Modern Jenkins (2.5xx+) uses `/manage/log/<name>`; older installs may use `/log/<name>/text`. |
| `OUTPUT_DIR` | `./jenkins-logs` | Directory where collected log files are written |
| `POLL_INTERVAL` | `30` | Seconds between polls in `api` mode |
| `ONCE_OUTPUT` | *(timestamped file)* | Override output path for `once` mode |
| `JENKINS_LOG_FILE` | `/var/log/jenkins/jenkins.log` | Used by `file` mode only (local filesystem path) |

### Generating a Jenkins API token

1. Log in to Jenkins
2. Go to **`<JENKINS_URL>/user/<username>/configure`**
3. Under **API Token**, click **Add new Token** → name it → **Generate**
4. Copy the token into `JENKINS_TOKEN` in `.env`

### Log recorder endpoint

The API polls a named log recorder. The default recorder is `all`, accessible
at `/manage/log/all` on Jenkins 2.5xx+. If the endpoint returns a 404:

1. Check the recorder exists at **Manage Jenkins → System Log**
2. If it doesn't exist, create it via the Script Console:

```groovy
import java.util.logging.*
import hudson.logging.*

def recorder = new LogRecorder("all")
recorder.loggers.add(new LogRecorder.Target("", Level.ALL))
Jenkins.get().log.logRecorders.put("all", recorder)
recorder.save()
println "Created log recorder 'all'"
```

### Buffer size

The log recorder page shows only the last N entries (default: 256). To
increase this for `once` mode to return a fuller history, run in the Script
Console:

```groovy
def recorder = Jenkins.get().log.logRecorders.get("all")
recorder.loggers[0].count = 10000
recorder.save()
println "Buffer size updated"
```

> **Note:** For a complete, unbuffered copy of the log, use
> [`scp-jenkins-log.sh`](scp-jenkins-log.md) instead.

---

## How It Works

### API mode (continuous)

1. Fetches the log recorder page at `JENKINS_URL + LOG_RECORDER_PATH`
2. **Auto-detects** whether the response is plain text or HTML:
   - **Plain text** (older Jenkins): uses `Range: bytes=N-` to fetch only
     new bytes since the last poll — efficient, append-only
   - **HTML** (modern Jenkins): strips tags, extracts log entry lines, and
     overwrites the output file when the page content changes
3. On each poll, new content is written to `<OUTPUT_DIR>/jenkins-api.log`
4. Connection failures are logged and retried after `POLL_INTERVAL` seconds

### Once mode

Single HTTP fetch of the current log recorder page. Applies the same
HTML/plain-text auto-detection. Writes to a timestamped file and exits.

### Output files

| File | Written by |
|------|------------|
| `jenkins-api.log` | `api` mode — continuously updated |
| `jenkins-<YYYYMMDD_HHMMSS>.log` | `once` mode — one file per run |
| `jenkins.log_<timestamp>` | `file` mode — snapshot on write |
| `jenkins.log_rotated_<timestamp>` | `file` mode — copy on rotation |
| `.last_html_hash` | Internal — tracks last seen page hash to avoid redundant writes |

---

## Securing credentials

Credentials are loaded from `.env` in priority order:

1. Shell environment variables (highest priority — use for CI/CD)
2. `.env.gpg` — GPG-encrypted env file, decrypted into memory at startup
3. `.env` — plaintext fallback (must be `chmod 600`, never commit)

Encrypt `.env` with GPG:

```bash
# Symmetric (passphrase)
gpg --symmetric --cipher-algo AES256 -o .env.gpg .env

# Asymmetric (keypair)
gpg --encrypt --recipient your@email.com -o .env.gpg .env
```

The script decrypts `.env.gpg` automatically if it exists and `gpg` is
available.

---

## Running as a Service

```bash
# Background with nohup
nohup ./collect-jenkins-log.sh api > collector.log 2>&1 &
echo $! > collector.pid

# Stop
kill $(cat collector.pid)
```

Example `systemd` unit:

```ini
[Unit]
Description=Jenkins Log Collector (API)
After=network.target

[Service]
Type=simple
EnvironmentFile=/path/to/tools/jenkins-log-collector/.env
ExecStart=/path/to/tools/jenkins-log-collector/collect-jenkins-log.sh api
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jenkins-log-collector-api
sudo journalctl -u jenkins-log-collector-api -f
```
