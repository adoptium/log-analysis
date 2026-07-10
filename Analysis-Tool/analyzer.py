"""
jenkins_log_analyzer.py
=======================

A small, dependency-light toolkit for turning Jenkins logs into structured,
queryable events and running analytics over them.

Pipeline (each stage is independent and testable):

    raw text
      -> JenkinsLogParser.parse()      # multi-line aware -> list[LogEvent]
      -> TemplateExtractor.assign()    # drain3 cluster id + template per event
      -> RuleSet.apply()               # ignore / tag / reclassify events
      -> analytics / time queries / JSON export

The key idea: the unit of analysis is an *event*, not a line. A Jenkins event
is a header line (timestamp + thread + level + logger#method: message) optionally
followed by continuation lines (a wrapped message, an exception, a stack trace).
We split the human message (good for templating) from the stack trace (noise for
templating, but exactly what you want to hand to an LLM later).

drain3 is optional: if it isn't installed, templating is skipped gracefully and
everything else still works.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Iterable, Optional, Union
from pathlib import Path


# The exact format Jenkins prints, e.g. "2026-06-02 22:17:45.108+0000"
TS_FMT = "%Y-%m-%d %H:%M:%S.%f%z"

# Anything that can stand in for a point in time when calling the query helpers.
TimeLike = Union[datetime, str]

# Default path for the drain3 snapshot — shared across all analyze() calls so
# template IDs remain stable across files.
DEFAULT_DRAIN_STATE = Path(__file__).resolve().parent / "drain3_state.bin"


def parse_timestamp(value: TimeLike) -> datetime:
    """
    Turn a user-supplied time into a datetime.

    Accepts, in order of preference:
      * a datetime (returned unchanged),
      * a raw Jenkins timestamp string copied straight from a log/report
        e.g. "2026-06-02 22:17:45.108+0000",
      * an ISO-8601 string as produced by LogEvent.to_dict()
        e.g. "2026-06-02T22:17:45.108000+00:00".

    So you can copy the timestamp out of the fatal-events report and pass it
    directly, without building a datetime yourself.
    """
    if isinstance(value, datetime):
        return value
    text = value.strip()
    try:
        return datetime.strptime(text, TS_FMT)
    except ValueError:
        return datetime.fromisoformat(text)


# --------------------------------------------------------------------------- #
# 1. The event model
# --------------------------------------------------------------------------- #

@dataclass
class LogEvent:
    line_start: int                       # 1-based line number of the header
    line_end: int                         # last physical line belonging to event
    timestamp: Optional[datetime] = None
    timestamp_raw: Optional[str] = None
    thread_id: Optional[str] = None
    level: Optional[str] = None           # INFO / WARNING / SEVERE / ...
    logger: Optional[str] = None          # e.g. o.e.j.e.n.ContextHandler$APIContext
    method: Optional[str] = None          # e.g. log
    message: str = ""                     # cleaned, single-logical-line: drain3 input
    stack_trace: Optional[str] = None     # full continuation block: for the LLM
    raw: str = ""                         # original text, verbatim

    # filled in by TemplateExtractor
    template_id: Optional[int] = None
    template: Optional[str] = None

    # filled in by RuleSet
    tags: list[str] = field(default_factory=list)
    ignored: bool = False

    def to_dict(self) -> dict:
        d = asdict(self)
        d["timestamp"] = self.timestamp.isoformat() if self.timestamp else None
        return d


# --------------------------------------------------------------------------- #
# 2. Parsing raw text into events
# --------------------------------------------------------------------------- #

class JenkinsLogParser:
    """
    Splits raw Jenkins log text into LogEvent objects.

    A new event starts on any line matching HEADER_RE. Every other line is a
    continuation of the current event. This single rule handles wrapped
    messages, exceptions and stack traces correctly, because none of those
    start with a timestamp.
    """

    # 2026-06-02 22:17:43.181+0000 [id=581394]\tINFO\tlogger#method: message
    HEADER_RE = re.compile(
        r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4})"
        r"\s+\[id=(?P<tid>\d+)\]"
        r"\s+(?P<level>[A-Z]+)"
        r"\s+(?P<logger>[^#\s:]+)"
        r"(?:#(?P<method>\w+))?"
        r":\s?(?P<msg>.*)$"
    )
    # lines we treat as "stack trace" rather than human message
    _FRAME_RE = re.compile(r"^\s*(at\s|\.\.\.\s*\d+\s+more|Caused by:|Suppressed:)")
    # a throwable summary line, e.g. "hudson.AbortException: Cannot resume..."
    _THROWABLE_RE = re.compile(
        r"^[\w.$]+(?:Exception|Error|Throwable)\d*\b"
    )

    def parse(self, text: str) -> list[LogEvent]:
        events: list[LogEvent] = []
        current: Optional[LogEvent] = None
        cont: list[str] = []          # raw continuation lines for current event

        def flush():
            nonlocal current, cont
            if current is not None:
                self._finalize(current, cont)
                events.append(current)
            current, cont = None, []

        for i, line in enumerate(text.splitlines(), start=1):
            m = self.HEADER_RE.match(line)
            if m:
                flush()
                current = self._from_header(m, i, line)
            elif current is not None:
                cont.append(line)
                current.line_end = i
            # lines before the first header (rare preamble) are dropped on purpose
        flush()
        return events

    def _from_header(self, m: re.Match, lineno: int, raw: str) -> LogEvent:
        ts_raw = m.group("ts")
        try:
            ts = parse_timestamp(ts_raw)
        except ValueError:
            ts = None
        return LogEvent(
            line_start=lineno,
            line_end=lineno,
            timestamp=ts,
            timestamp_raw=ts_raw,
            thread_id=m.group("tid"),
            level=m.group("level"),
            logger=m.group("logger"),
            method=m.group("method"),
            message=m.group("msg").strip(),
            raw=raw,
        )

    def _finalize(self, ev: LogEvent, cont: list[str]):
        """Split continuation lines into (extra message, stack trace)."""
        if cont:
            ev.raw = ev.raw + "\n" + "\n".join(cont)
        # The first continuation line is often the throwable summary which is
        # useful signal; lines that look like frames are pure noise.
        stack_lines = [c for c in cont if c.strip()]
        if stack_lines:
            ev.stack_trace = "\n".join(stack_lines)


# --------------------------------------------------------------------------- #
# 3. Cleaning a message for drain3
# --------------------------------------------------------------------------- #

def clean_for_drain(ev: LogEvent, include_throwable_type: bool = True) -> str:
    """
    Produce the string fed to drain3. We keep the human message and, optionally,
    the *type* of the leading throwable (great clustering signal), but drop all
    stack frames. drain3's own masking then handles numbers / URLs / ids.
    """
    parts = [ev.message]
    if include_throwable_type and ev.stack_trace:
        first = ev.stack_trace.splitlines()[0].strip()
        mt = re.match(r"([\w.$]+(?:Exception|Error|Throwable)\d*)", first)
        if mt:
            parts.append(mt.group(1))
    return " ".join(p for p in parts if p).strip()


# --------------------------------------------------------------------------- #
# 4. drain3 templating (optional dependency)
# --------------------------------------------------------------------------- #

class TemplateExtractor:
    """Wraps drain3. Falls back to a no-op if drain3 isn't installed."""

    def __init__(self, persistence_path: Optional[Path] = None):
        self.miner = None
        if persistence_path is None:
            persistence_path = DEFAULT_DRAIN_STATE
        try:
            from drain3 import TemplateMiner
            from drain3.template_miner_config import TemplateMinerConfig
            from drain3.masking import MaskingInstruction
            from drain3.file_persistence import FilePersistence

            cfg = TemplateMinerConfig()
            cfg.profiling_enabled = False
            # Mask the high-cardinality stuff so similar events collapse together.
            cfg.masking_instructions = [
                MaskingInstruction(r"https?://[^\s:]+", "URL"),
                MaskingInstruction(r"(/[\w.\-]+)+", "PATH"),
                MaskingInstruction(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "IP"),
                MaskingInstruction(r"#\d+", "#NUM"),
                MaskingInstruction(r"\b0x[0-9a-fA-F]+\b", "HEX"),
                MaskingInstruction(r"\b\d+\b", "NUM"),
            ]
            cfg.drain_sim_th = 0.4   # similarity threshold; tune to taste
            persistence = FilePersistence(str(persistence_path))
            self.miner = TemplateMiner(persistence_handler=persistence, config=cfg)
        except Exception as e:  # drain3 missing or failed to init
            self._reason = str(e)

    def assign(self, events: Iterable[LogEvent]):
        if self.miner is None:
            return
        for ev in events:
            res = self.miner.add_log_message(clean_for_drain(ev))
            ev.template_id = res["cluster_id"]
            ev.template = res["template_mined"]


# --------------------------------------------------------------------------- #
# 5. Ruleset: ignore / tag / reclassify
# --------------------------------------------------------------------------- #

@dataclass
class Rule:
    name: str
    action: str = "ignore"                 # "ignore" | "tag" | "set_level"
    # match conditions (all that are present must match)
    level: Optional[str] = None
    logger_regex: Optional[str] = None
    template_id: Optional[int] = None
    message_regex: Optional[str] = None
    stack_regex: Optional[str] = None
    # action params
    tag: Optional[str] = None
    set_level: Optional[str] = None

    def matches(self, ev: LogEvent) -> bool:
        if self.level and ev.level != self.level:
            return False
        if self.template_id is not None and ev.template_id != self.template_id:
            return False
        if self.logger_regex and not re.search(self.logger_regex, ev.logger or ""):
            return False
        if self.message_regex and not re.search(self.message_regex, ev.message or ""):
            return False
        if self.stack_regex and not re.search(self.stack_regex, ev.stack_trace or ""):
            return False
        return True


class RuleSet:
    def __init__(self, rules: list[Rule]):
        self.rules = rules

    @classmethod
    def from_list(cls, raw: list[dict]) -> "RuleSet":
        return cls([Rule(**r) for r in raw])

    def apply(self, events: Iterable[LogEvent]):
        for ev in events:
            for rule in self.rules:
                if not rule.matches(ev):
                    continue
                if rule.action == "ignore":
                    ev.ignored = True
                elif rule.action == "tag" and rule.tag:
                    ev.tags.append(rule.tag)
                elif rule.action == "set_level" and rule.set_level:
                    ev.level = rule.set_level


# --------------------------------------------------------------------------- #
# 6. Analytics + time queries
# --------------------------------------------------------------------------- #

FATAL_LEVELS = {"SEVERE", "FATAL", "ERROR"}

SCRIPT_DIR = Path(__file__).resolve().parent
output_path = SCRIPT_DIR / "analyzer_output"
output_path.mkdir(exist_ok=True)


def active(events: list[LogEvent]) -> list[LogEvent]:
    """Events not suppressed by the ruleset."""
    return [e for e in events if not e.ignored]


def top_templates(events: list[LogEvent], n: int = 20) -> None:
    from collections import Counter
    c = Counter()
    sample = {}
    for e in active(events):
        if e.template_id is None:
            continue
        c[e.template_id] += 1
        sample.setdefault(e.template_id, (e.template, e.message))
    out = []
    for tid, count in c.most_common(n):
        tmpl, msg = sample[tid]
        out.append({"template_id": tid, "count": count,
                    "template": tmpl, "example": msg})
    with open(output_path / f"top-{n}-messages", "w", encoding="utf-8") as f:
        i=1
        for t in out:
            f.write(f"  [#{i}:{t['template_id']:>2}] x{t['count']}  {t['template']}\n")
            i+=1


def fatal_events(events: list[LogEvent]) -> None:
    with open(output_path/f'fatal-events', "w", encoding="UTF-8") as f:
        for e in active(events):
            if (e.level or "") in FATAL_LEVELS:
                f.write(f"  line {e.line_start} at {e.timestamp} ,{e.level}: {e.message}\n")


def level_counts(events: list[LogEvent]) -> dict:
    from collections import Counter
    return dict(Counter(e.level for e in active(events)))


def in_window(events: list[LogEvent], center: TimeLike,
              before: timedelta, after: timedelta) -> None:
    """
    Return events within [center - before, center + after].

    `center` may be a datetime OR a timestamp string copied straight from a
    log line / the fatal-events report, e.g.:

        in_window(events, "2026-06-02 22:17:45.108+0000",
                  timedelta(hours=1), timedelta(hours=1))
    """
    center = parse_timestamp(center)
    lo, hi = center - before, center + after
    with open(output_path/f'{str(before)}-before-{str(center)}-and-{str(after)}-after', "w", encoding="UTF-8") as f:
        for e in events:
            if e.timestamp and lo <= e.timestamp <= hi:
                f.write(f"  line {e.line_start} at {e.timestamp} ,{e.level}: {e.message}\n")

def sys_correspond(jenkins_time: TimeLike, syspath: Path, threshold: timedelta) -> None:
    SYSLOG_RE_LINE=re.compile(r'(?P<DATE>\d{4}-\d{2}-\d{2})T(?P<TIME>\d{2}:\d{2}:\d{2}\.\d+[+-]\d\d:\d\d) (?P<SYSTEM>.*\[\d*\]): (?P<MESSAGE>.*)')
    good_lines=[]
    jenkins_ts=parse_timestamp(jenkins_time)
    with open(syspath,"r",encoding="utf-8") as file:
        for line in file:
            syslog_match=SYSLOG_RE_LINE.match(line)
            if syslog_match:
                dt_string=syslog_match.group("DATE")+" "+syslog_match.group("TIME")
                syslog_ts=parse_timestamp(dt_string)
                delta_secs = ((syslog_ts - jenkins_ts).total_seconds()) 
                if abs(timedelta(seconds=delta_secs))<threshold:
                    good_lines.append((delta_secs,line))
    with open(output_path/f'sys-match-{jenkins_time}', "w", encoding="UTF-8") as f:
        good_lines.sort(key=lambda x: x[0])
        for line in good_lines:
            f.write(f'[delay: {line[0]}] {line[1]}')
    



# --------------------------------------------------------------------------- #
# 7. Convenience entry point
# --------------------------------------------------------------------------- #

def analyze(path: Path, rules: Optional[list[dict]] = None,
            persistence_path: Optional[Path] = None) -> list[LogEvent]:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    events = JenkinsLogParser().parse(text)
    TemplateExtractor(persistence_path=persistence_path).assign(events)
    if rules:
        RuleSet.from_list(rules).apply(events)
    return events


def to_json(events: list[LogEvent], indent: int = 2) -> str:
    return json.dumps([e.to_dict() for e in events], indent=indent)


if __name__ == "__main__":
    import sys
    input_path=Path.cwd()/Path("sample-logs","jenkins","jenkins.log.24052026")
    evs = analyze(sys.argv[1] if len(sys.argv) > 1 else input_path)
    print(f"parsed {len(evs)} events\n")
    print("level counts:", level_counts(evs))
    top_templates(evs, 12)
    fatal_events(evs)
    sys_correspond("2026-05-24 02:01:13.671000+00:00", Path("sample-logs","systems","syslog.1"),timedelta(seconds=313))