# Jenkins Log Collector

Tools for collecting the Jenkins system log from a remote Jenkins instance
and writing it to a local directory for ingestion by downstream tooling.

Two independent collection methods are provided — use whichever suits your
access to the Jenkins server:

| Script | Method | Access required |
|--------|--------|-----------------|
| [`collect-jenkins-log.sh`](docs/collect-jenkins-log.md) | Jenkins REST API over HTTPS | Jenkins API token |
| [`scp-jenkins-log.sh`](docs/scp-jenkins-log.md) | SCP/SSH direct file copy | SSH key access to the Jenkins host |

---

## Shared configuration

Both scripts read from a shared `.env` file in this directory:

```bash
cp dot.env.example .env
$EDITOR .env
```

`.env` is gitignored. See each script's documentation for the variables it
requires.

---

## Choosing a method

**Use the API script** (`collect-jenkins-log.sh`) when:
- You only have HTTP access to Jenkins (no SSH to the server)
- You want continuous polling that appends new log lines incrementally
- You are collecting from a managed or cloud-hosted Jenkins

**Use the SCP script** (`scp-jenkins-log.sh`) when:
- You have SSH access to the Jenkins host
- You want the complete, untruncated log file with no buffer limits
- You want a simple one-shot copy without running a persistent process

Both scripts share the same `.env` file, so you can switch between them or
run both without duplicating configuration.
