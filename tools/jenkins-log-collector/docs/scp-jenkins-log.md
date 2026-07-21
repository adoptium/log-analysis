# scp-jenkins-log.sh — SCP-based log collector

Copies the Jenkins system log directly from the Jenkins host filesystem over
SSH/SCP. Retrieves the complete, untruncated log file with no API buffer
limits.

---

## Modes

| Mode | Behaviour |
|------|-----------|
| `once` | Copy the log file once, write to a timestamped file, then exit **(default)** |
| `watch` | Poll the remote file every `POLL_INTERVAL` seconds; copy when size or mtime changes |

---

## Requirements

| Dependency | Notes |
|------------|-------|
| `bash` ≥ 4 | |
| `ssh` | Standard OpenSSH client |
| `scp` | Included with OpenSSH |
| SSH key pair | Key must be authorised on the Jenkins host for `SSH_USER` |

---

## Quick Start

```bash
# 1. Generate an SSH keypair if you don't have one
ssh-keygen -t ed25519 -C "jenkins-log-collector" -f ~/.ssh/jenkins_log_key

# 2. Authorise the public key on the Jenkins host
ssh-copy-id -i ~/.ssh/jenkins_log_key.pub SSH_USER@jenkins-host

# 3. Fill in the config
cp ../dot.env.example ../.env
$EDITOR ../.env          # set SSH_HOST, SSH_USER, SSH_KEY, REMOTE_LOG_FILE

# 4. Make executable (first time only)
chmod +x scp-jenkins-log.sh

# 5. Run
./scp-jenkins-log.sh          # one-off copy, then exit
./scp-jenkins-log.sh watch    # continuous watch
```

---

## Configuration

All variables are set in the shared `.env` file one directory up.

| Variable | Default | Description |
|----------|---------|-------------|
| `SSH_HOST` | *(required)* | Hostname or IP of the Jenkins server |
| `SSH_USER` | `jenkins` | SSH username on the Jenkins host |
| `SSH_PORT` | `22` | SSH port |
| `SSH_KEY` | `~/.ssh/id_rsa` | Path to your SSH private key |
| `REMOTE_LOG_FILE` | `/var/log/jenkins/jenkins.log` | Full path to `jenkins.log` on the remote host |
| `OUTPUT_DIR` | `./jenkins-logs` | Local directory where copied log files are written |
| `POLL_INTERVAL` | `30` | Seconds between checks in `watch` mode |
| `ONCE_OUTPUT` | *(timestamped file)* | Override output path for `once` mode |

### Common `REMOTE_LOG_FILE` paths

| Install type | Path |
|---|---|
| Debian/Ubuntu package | `/var/log/jenkins/jenkins.log` |
| RHEL/Fedora package | `/var/log/jenkins/jenkins.log` |
| WAR / custom install | `$JENKINS_HOME/jenkins.log` |

### SSH key setup

The key must be a **dedicated key** for this collector — do not reuse a
personal key. Restrict what the key can do on the server by prefixing the
`authorized_keys` entry with options:

```
# /home/jenkins/.ssh/authorized_keys on the Jenkins host
command="cat /var/log/jenkins/jenkins.log",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... jenkins-log-collector
```

This locks the key to a single `cat` command — even if the private key is
compromised it cannot be used for anything other than reading that one file.

> **Note:** The `command=` restriction means `scp` (which uses a remote
> shell) won't work with it. Use `ssh` + pipe instead, or omit the
> restriction if full SCP is needed.

---

## How It Works

### Once mode

1. Validates `SSH_HOST` is set and `SSH_KEY` exists locally
2. Runs `scp` to copy `REMOTE_LOG_FILE` to `<dest>.tmp`
3. Atomically renames `.tmp` → final destination — the output file is never
   partially written
4. Logs the byte count and exits

### Watch mode

1. On each poll, runs a single `ssh stat` command to get the remote file's
   size and mtime — minimal network overhead
2. If either value changed since the last poll, copies the full file
3. Copies to a new timestamped file each time — retains history
4. SCP failures are logged and retried on the next poll interval

### Why SCP rather than rsync?

`scp` is available everywhere OpenSSH is installed and needs no server-side
daemon beyond `sshd`. `rsync` would be more efficient for large files
(delta transfer) but requires `rsync` on the server. If the Jenkins host has
`rsync` and the log is very large, you can swap the `scp` call for:

```bash
rsync -az -e "ssh -i ${SSH_KEY} -p ${SSH_PORT}" \
    "${SSH_USER}@${SSH_HOST}:${REMOTE_LOG_FILE}" "$dest"
```

---

## Output files

| File | Written by |
|------|------------|
| `jenkins-<YYYYMMDD_HHMMSS>.log` | `once` mode — one timestamped file per run |
| `jenkins-<YYYYMMDD_HHMMSS>.log` | `watch` mode — one timestamped file per detected change |

---

## Securing credentials

The SSH private key path is set in `.env`. Protect both files:

```bash
chmod 600 ~/.ssh/jenkins_log_key
chmod 600 .env
```

The `.env` file itself can be GPG-encrypted — see the [API collector docs](collect-jenkins-log.md#securing-credentials) for the GPG setup, which applies equally here since both scripts share the same `.env` loader.

---

## Running as a Service

```bash
# One-off via cron (every 15 minutes)
*/15 * * * * /path/to/scp-jenkins-log.sh once >> /var/log/jenkins-scp-collector.log 2>&1

# Continuous watch with nohup
nohup ./scp-jenkins-log.sh watch > watcher.log 2>&1 &
echo $! > watcher.pid

# Stop
kill $(cat watcher.pid)
```

Example `systemd` unit:

```ini
[Unit]
Description=Jenkins Log Collector (SCP)
After=network.target

[Service]
Type=simple
EnvironmentFile=/path/to/tools/jenkins-log-collector/.env
ExecStart=/path/to/tools/jenkins-log-collector/scp-jenkins-log.sh watch
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jenkins-log-collector-scp
sudo journalctl -u jenkins-log-collector-scp -f
```
