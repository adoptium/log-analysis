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

## The mental model: events, not lines

The single idea everything else rests on is that the unit of analysis is a
**log event**, not a line of text.

A raw Jenkins log looks like a flat sequence of lines, but a single logical
event often spans many physical lines. A warning is logged on one line, and
then its exception message and full stack trace continue on the lines below it:

```
2026-06-02 22:17:45.108+0000 [id=580770]  WARNING  o.j.p.workflow.job.WorkflowRun#getExecution: error in build ... #67
hudson.AbortException: Cannot resume build because FlowNode 12 ...
	at ...CpsFlowExecution.initializeStorage(CpsFlowExecution.java:802)
	at ...WorkflowRun.getExecution(WorkflowRun.java:743)
	... 12 more
```

All five of those lines are **one event**. The analyzer groups them back
together so you can reason about the event as a whole rather than as scattered
lines. A new event begins only on a line that starts with a timestamp;
everything else is treated as a continuation of the event above it.

## What an event contains

Each event is represented by a `LogEvent` record with these fields:

| Field | Meaning |
| --- | --- |
| `line_start`, `line_end` | The physical line range the event occupies in the file. |
| `timestamp` | The event time as a timezone-aware `datetime`. |
| `timestamp_raw` | The original timestamp string, exactly as written in the log. |
| `thread_id` | The Jenkins thread id (`[id=580770]`). |
| `level` | `INFO`, `WARNING`, `SEVERE`, etc. |
| `logger`, `method` | Where the line came from, e.g. `WorkflowRun` and `getExecution`. |
| `message` | The clean, single-line human message. This is what feeds template extraction. |
| `stack_trace` | The full continuation block (exception + stack frames), kept separate. |
| `raw` | The complete original text of the event, verbatim. |
| `template_id`, `template` | Assigned by drain3 — see below. |
| `tags`, `ignored` | Set by your ruleset — see below. |

The most important split is **`message` vs `stack_trace`**. The human message is
short and good for grouping; the stack trace is noise for grouping but is
exactly the detail you would hand to a human (or an AI) when troubleshooting.
Keeping them in separate fields means you never have to re-parse to get one or
the other.

## Templates and `template_id`

Two events are rarely identical — URLs, build numbers, and job names differ —
but they often describe the *same kind* of thing. A **template** is the
generalized shape of a message with the variable parts replaced by
placeholders. For example, these three messages:

```
While serving https://.../job/A/2286/: anonymous is missing the Job/Build permission
While serving https://.../job/B/516/:  anonymous is missing the Job/Build permission
While serving https://.../job/C/123/:  anonymous is missing the Overall/Read permission
```

collapse into one template:

```
While serving <URL>: hudson.security.AccessDeniedException3: anonymous is missing the <PATH> permission
```

The clustering is done by the **drain3** library. Each distinct template gets a
stable `template_id` (an integer), and every event is tagged with the id of the
template it belongs to. That is what makes "the 20 most frequent error
templates" a meaningful, countable thing rather than thousands of near-identical
unique strings.

## Rulesets

A **ruleset** is an ordered list of rules that decide what to do with matching
events — most commonly, to *ignore* the noisy ones. Each rule has match
conditions (combined with AND) and an action. For example, "silence the
permission-denied noise and flag any out-of-memory error as critical":

```python
rules = [
    {"name": "ignore-anon-perms", "action": "ignore",
     "message_regex": "anonymous is missing the"},
    {"name": "flag-oom",          "action": "tag", "tag": "critical",
     "stack_regex": "OutOfMemoryError"},
]
```

Match conditions you can use: `level`, `logger_regex`, `template_id`,
`message_regex`, `stack_regex`. Actions: `ignore` (sets `ignored = True`),
`tag` (appends to `tags`, requires `tag`), and `set_level` (rewrites `level`,
requires `set_level`). The analytics functions all skip events whose `ignored`
flag is set, so ignoring an event removes it from every report.

---

## Requirements and setup

- **Python 3.10+** (uses modern type-hint syntax such as `list[str]`).
- **drain3** is required for template extraction: `pip install drain3`.
  If it is not installed the parser and analytics still run, but
  `template_id` / `template` stay empty.
---

## Quick start

```python
from datetime import timedelta
from jenkins_log_analyzer import (
    analyze, top_templates, fatal_events, level_counts, in_window,
)

# 1. Run the pipeline: parse -> assign templates -> (optionally) apply rules.
events = analyze("sample.log")

# 2. Write the analytics reports into output/.
top_templates(events, n=20)   # -> output/top-20-messages
fatal_events(events)          # -> output/fatal-events

# 3. level_counts still RETURNS a dict (it does not write a file).
print(level_counts(events))   # e.g. {'INFO': 3, 'WARNING': 1, 'SEVERE': 1}

# 4. Query a time window around a copied timestamp.
in_window(
    events,
    "2026-06-02 22:17:45.108+0000",   # paste straight from a report
    timedelta(hours=1),                # 1 hour before
    timedelta(hours=1),                # 1 hour after
)   # -> output/<before>-before-<center>-and-<after>-after
```

To apply a ruleset, pass it to `analyze`:

```python
events = analyze("sample.log", rules=rules)   # rules as shown above
```

To export every event as JSON:

```python
from jenkins_log_analyzer import to_json
with open("events.json", "w", encoding="utf-8") as f:
    f.write(to_json(events))
```

---

## Function reference

### The pipeline

`analyze(path, rules=None) -> list[LogEvent]`
Reads the file at `path`, parses it into events, assigns drain3 templates, and
(if `rules` is given) applies the ruleset. Returns the list of events. This is
the function you call first; everything else consumes its result.

`to_json(events, indent=2) -> str`
Serializes the events to a JSON string. Pair it with `open(...).write(...)` to
save a file.

### Analytics and queries

These all take the `events` list returned by `analyze`. Note that three of them
now **write a file and return `None`**, while `level_counts` returns a value.

| Function | What it does | Output |
| --- | --- | --- |
| `active(events)` | Returns only events not marked `ignored`. Used internally by the others. | returns `list[LogEvent]` |
| `top_templates(events, n=20)` | The `n` most frequent templates among active events, with counts and an example message. | writes `output/top-{n}-messages` |
| `fatal_events(events)` | Active events whose level is fatal (`SEVERE`, `FATAL`, or `ERROR`), with line number and timestamp. | writes `output/fatal-events` |
| `level_counts(events)` | Tally of how many active events occurred at each level. | **returns** a `dict` |
| `in_window(events, center, before, after)` | Events within `[center - before, center + after]`. | writes a file named from the window |
| `sys_correspond(date, path, threshold)` | Events within `[date - threshold, date + threshold]` from the syslog at path are printed, ordered by distance |

The `center` argument of `in_window` is flexible: pass a `datetime`, a raw
Jenkins timestamp string (`"2026-06-02 22:17:45.108+0000"`), or the ISO string
produced in the JSON export. The `before` and `after` arguments are
`datetime.timedelta` objects, e.g. `timedelta(hours=1)` or
`timedelta(minutes=30)`. Same for sys_correspond

---

## Output files

All reports land in the `output/` directory beside the script:

- `output/top-{n}-messages` — one line per template, ranked, in the form
  `[#rank:template_id] x<count>  <template>`.
- `output/fatal-events` — one line per fatal event:
  `line <n> at <timestamp> ,<level>: <message>`.
- `output/<before>-before-<center>-and-<after>-after` — one line per event in
  the time window, same format as the fatal report. The filename is built from
  the window bounds, so it encodes exactly which query produced it.

### A note on filenames

The `in_window` output filename includes the timestamp and the `timedelta`
strings, which contain spaces and colons (e.g.
`1:00:00-before-2026-06-02 22:17:45.108000+00:00-and-1:00:00-after`). That is
fine on Linux/macOS, but **colons and spaces are invalid in filenames on
Windows**, so if this tool ever needs to run there, sanitize those characters
(replace `:` and spaces) when building the name. None of the report files have
an extension; add `.txt` if you want them to open in an editor by double-click.

---

## End-to-end example

```python
from datetime import timedelta
from jenkins_log_analyzer import analyze, top_templates, fatal_events, level_counts, in_window

rules = [
    {"name": "ignore-anon-perms", "action": "ignore",
     "message_regex": "anonymous is missing the"},
]

events = analyze("sample.log", rules=rules)

print(level_counts(events))          # quick console summary
top_templates(events, n=20)          # output/top-20-messages
fatal_events(events)                 # output/fatal-events
in_window(events, "2026-06-02 22:17:45.108+0000",
          timedelta(hours=1), timedelta(hours=1))
```

After running this you will have an `output/` folder containing the three
reports, with the permission-denied noise already filtered out by the ruleset.
