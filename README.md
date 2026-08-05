
# Eclipse-Log-Analysis

## Project description
This project proposes the development of an AI-powered log analysis assistant designed to automatically review Jenkins server logs, system logs (such as syslog), and other infrastructure outputs to identify warnings, errors, and anomalous patterns in real time. By leveraging modern machine learning and natural language processing techniques, the tool will intelligently parse large volumes of unstructured log data, prioritise issues based on severity and historical impact, and correlate related events across multiple sources to provide meaningful insights rather than raw noise.

## Goals
1. Identify and gather the various server and system logs to be used for input to 'automated log analysis' assistant.
2. Analyze infrastructure logs to detect and alert on security issues.
3. Create a smooth customer experience for interacting with the workflows and automation.
4. Summarize and generate useful reporting on findings.

## Team
Samuel Yuan, Marcus White, Faisal Toosan, Hani Murtaza, Yuchen Zhou, Aashka Shah
# Jenkins Log Analyzer — Usage Guide

A small Python toolkit that turns raw Jenkins logs into structured, queryable
records and writes analytics reports to disk. This document explains the core
concepts first (what a "log event" is and why it matters), then how to run each
part.

---

## How to run the webapp:
### Start a virtual environment
python3 -m venv venv
source venv/bin/activate

### Start the backend
cd Analysis-Tool
pip install -r requirements.txt
uvicorn api:app --reload

#Frontend (from Log-Analysis-Webapp/)
cd ../Log-Analysis-Webapp 
npm install
npm run dev

### The analyzer layer

`analyzer.py` is the **ingestion and structuring layer**. Its one
job is to turn raw, messy Jenkins log text into clean, structured `LogEvent`
records (and JSON). It does no querying itself — the DuckDB layer sits on top
and runs the SQL. In short: the analyzer produces the *rows*, DuckDB provides
the *queries*.

### Events, not lines

The core idea is that the unit of analysis is a **log event**, not a line. A
single event often spans several physical lines — a header line followed by an
exception message and stack trace:

```
2026-06-02 22:17:45.108+0000 [id=580770] WARNING o.j.p...WorkflowRun#getExecution: error in build ... #67
hudson.AbortException: Cannot resume build because FlowNode 12 ...
	at ...WorkflowRun.getExecution(WorkflowRun.java:743)
	... 12 more
```

Those lines are **one event**. The parser groups them back together: a new
event begins only on a line that starts with a timestamp, and everything else
is a continuation of the event above it. This is what lets the rest of the
system treat an event as a single addressable thing.

### The `LogEvent` record (the schema DuckDB queries)

Each event becomes a `LogEvent`, and these fields are effectively the columns
the DuckDB layer loads and queries:

| Field | Meaning |
| --- | --- |
| `line_start`, `line_end` | Physical line range of the event in the file. |
| `timestamp` | Event time, timezone-aware. |
| `timestamp_raw` | Original timestamp string, verbatim. |
| `thread_id` | Jenkins thread id (`[id=580770]`). |
| `level` | `INFO`, `WARNING`, `SEVERE`, etc. |
| `logger`, `method` | Origin of the line. |
| `message` | Clean, single-line human message (the input to templating). |
| `stack_trace` | Full continuation block (exception + frames), kept separate. |
| `raw` | Complete original text of the event. |
| `template_id`, `template` | Assigned by drain3. |
| `tags`, `ignored` | Set by the ruleset. |

The key split is **`message` vs `stack_trace`**: the short human message is what
gets clustered, while the noisy stack trace is preserved separately for
troubleshooting (and the AI step). Because both live on the record, the DuckDB
layer can filter on one and surface the other without any re-parsing.

### Templates (`template_id`) via drain3

Events are rarely byte-identical (URLs, build numbers, and job names vary) but
often describe the same *kind* of thing. drain3 clusters similar messages into
**templates** and gives each a stable integer `template_id`:

```
While serving <URL>: ...AccessDeniedException3: anonymous is missing the <PATH> permission
```

Every event carries its template id, which is what makes "top 20 error
templates" a countable `GROUP BY template_id` in the query layer rather than a
pile of near-duplicate strings.

### Rulesets

A **ruleset** is an ordered list of match/action rules applied during parsing,
mainly to mark noise as `ignored` so it can be excluded downstream:

```python
rules = [
    {"name": "ignore-anon-perms", "action": "ignore",
     "message_regex": "anonymous is missing the"},
]
```

Match on `level`, `logger_regex`, `template_id`, `message_regex`, or
`stack_regex` (combined with AND); actions are `ignore`, `tag`, and `set_level`.
The `ignored` and `tags` fields land on each `LogEvent`, so the query layer can
simply add `WHERE NOT ignored`.

### What this layer exposes upward

The DuckDB layer only needs two entry points:

- `analyze(path, rules=None) -> list[LogEvent]` — parse a log file, assign
  templates, apply any ruleset, and return the structured events.
- `to_json(events) -> str` — serialize those events to JSON for ingestion.

> **Note on the legacy analytics helpers.** The in-module functions
> `top_templates`, `fatal_events`, `in_window`, and `sys_correspond` predate the
> DuckDB layer. They still work, but the queries they perform are now expressed
> as SQL in the query layer, so they are effectively redundant and kept only as
> convenience shortcuts. New analysis should go through DuckDB, not these.