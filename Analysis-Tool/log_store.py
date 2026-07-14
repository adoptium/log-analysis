"""DuckDB-backed store for Jenkins log events and drain3 templates.

Merged design
-------------
Foundation is the class-based, data-returning store (EventStore) with a
*normalized* schema:

    templates(template_id PK, template, updated_at)   -- one row per drain cluster
    events(..., template_id FK, ...)                  -- no template string per row

The canonical template string lives in exactly one place, written from drain3's
own authoritative cluster state (miner.drain.id_to_cluster) rather than the
per-event `template_mined` string, which drifts as clusters generalize. This is
what makes template counts correct instead of fragmented.

Depth (time windows, by-logger, by-tag, cross-file correlation, file comparison,
template trend, tag summary, per-file breakdowns, an interactive shell and a
small ingestion CLI) is ported from the procedural duckdb_store.py, but every
method here *returns JSON-ready data* (list[dict] / dict) instead of writing
formatted text files — so a FastAPI/Flask layer can serialize results directly.

Every query is fully parameterized: no user-supplied value is ever interpolated
into SQL. source_file scoping accepts None (all files), a str (one file), or a
list[str] (a subset), resolved by _source_file_clause into placeholders.

    store = EventStore()
    ingest_file("jenkins.log", store)
    ingest_file("jenkins_log.crash", store)
    store.top_templates(20)
    store.cross_file_templates(min_files=2)

Dependencies: duckdb, pytz (DuckDB pulls pytz in for TIMESTAMPTZ handling),
and drain3 (via analyzer). pandas is optional but strongly recommended — it
enables the bulk-insert fast path (~600x faster ingestion on large files);
without it the store falls back to a slower transactional insert.
Install: pip install pytz drain3 pandas
"""

from __future__ import annotations

import argparse
import json
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Union

import duckdb

from analyzer import (
    JenkinsLogParser,
    LogEvent,
    RuleSet,
    TemplateExtractor,
    DEFAULT_DRAIN_STATE,
    SCRIPT_DIR,
    parse_timestamp,
)

FATAL_LEVELS = ("SEVERE", "FATAL", "ERROR")
DEFAULT_DB_PATH = SCRIPT_DIR / "jenkins_logs.duckdb"

# A source_file scope can be:
#   None        -> every ingested file
#   "a.log"     -> exactly one file
#   ["a","b"]   -> an arbitrary subset
SourceFileArg = Optional[Union[str, list[str]]]


def _source_file_clause(source_file: SourceFileArg) -> tuple[str, list]:
    """Turn a source_file scope into a parameterized SQL fragment + params.

    Returns ("", [])                         for None  (no filter)
    Returns ("AND source_file = ?", [p])     for a single string
    Returns ("AND source_file IN (?, ...)", ps) for a list
    Returns ("AND 1 = 0", [])                for an empty list (match nothing;
                                             an empty IN () is invalid SQL)

    `source_file` is only present on the events table, so the unqualified
    column name resolves unambiguously even inside JOINs against templates.
    Nothing here is ever string-formatted from user input — values become
    bound `?` parameters.
    """
    if source_file is None:
        return "", []
    if isinstance(source_file, str):
        return "AND source_file = ?", [source_file]
    paths = list(source_file)
    if not paths:
        return "AND 1 = 0", []
    placeholders = ", ".join("?" for _ in paths)
    return f"AND source_file IN ({placeholders})", paths


def _iso(ts) -> Optional[str]:
    """Render a timestamp as an ISO-8601 string (JSON-ready), or None."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.isoformat()
    return str(ts)


class EventStore:
    def __init__(self, db_path: Path | str = DEFAULT_DB_PATH):
        self.db_path = Path(db_path)
        self.con = duckdb.connect(str(self.db_path))
        self._init_schema()

    def _init_schema(self) -> None:
        # templates: one row per drain cluster. No cluster_size column — drain
        # only persists sizes opportunistically, so a reloaded miner reports
        # stale counts. Event counts are always computed from the events table.
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS templates (
                template_id  INTEGER PRIMARY KEY,
                template     TEXT,
                updated_at   TIMESTAMP
            )
        """)
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS events (
                source_file   TEXT,
                line_start    INTEGER,
                line_end      INTEGER,
                timestamp     TIMESTAMPTZ,
                timestamp_raw TEXT,
                thread_id     TEXT,
                level         TEXT,
                logger        TEXT,
                method        TEXT,
                message       TEXT,
                stack_trace   TEXT,
                template_id   INTEGER,
                tags          TEXT,
                ignored       BOOLEAN
            )
        """)

    # ── ingestion ──────────────────────────────────────────────────────────

    def already_ingested(self, source_file: str) -> bool:
        count = self.con.execute(
            "SELECT COUNT(*) FROM events WHERE source_file = ?",
            [source_file],
        ).fetchone()[0]
        return count > 0

    def upsert_templates(self, miner) -> None:
        """Write canonical template strings straight from drain's cluster state.

        This is the fix for template fragmentation: the template for a given
        template_id is stored once here (from drain's authoritative tokens),
        not duplicated onto every event where it would drift as the cluster
        generalizes.
        """
        if miner is None:
            return
        now = datetime.now(timezone.utc)
        rows = [
            [cluster.cluster_id, " ".join(cluster.log_template_tokens), now]
            for cluster in miner.drain.id_to_cluster.values()
        ]
        if rows:
            self.con.executemany(
                "INSERT OR REPLACE INTO templates (template_id, template, updated_at) "
                "VALUES (?, ?, ?)",
                rows,
            )

    # column order used by the bulk insert; matches the events table exactly
    _EVENT_COLUMNS = [
        "source_file", "line_start", "line_end", "timestamp", "timestamp_raw",
        "thread_id", "level", "logger", "method", "message", "stack_trace",
        "template_id", "tags", "ignored",
    ]

    def ingest(self, events: list[LogEvent], source_file: str, miner=None) -> int:
        if miner is not None:
            self.upsert_templates(miner)
        if not events:
            return 0
        rows = [
            (
                source_file, e.line_start, e.line_end, e.timestamp, e.timestamp_raw,
                e.thread_id, e.level, e.logger, e.method, e.message, e.stack_trace,
                e.template_id, json.dumps(e.tags), e.ignored,
            )
            for e in events
        ]
        self._bulk_insert(rows)
        return len(rows)

    def _bulk_insert(self, rows: list[tuple]) -> None:
        """Insert many rows fast.

        DuckDB is a columnar OLAP store: row-by-row executemany is
        pathologically slow (~150s for 68k rows in testing — each row is a
        separate append). The fast path hands DuckDB a whole column batch via
        a pandas DataFrame replacement scan (~0.2s for the same 68k rows,
        ~600x faster). dtype=object keeps Python None as SQL NULL and preserves
        tz-aware datetimes instead of coercing them to NaN/NaT.

        If pandas isn't available we fall back to executemany wrapped in a
        single transaction — still far quicker than autocommitting per row.
        """
        if not rows:
            return
        try:
            import pandas as pd
            df = pd.DataFrame(rows, columns=self._EVENT_COLUMNS, dtype=object)
            self.con.execute("INSERT INTO events SELECT * FROM df")  # df: replacement scan
        except ImportError:
            self.con.execute("BEGIN TRANSACTION")
            try:
                self.con.executemany(
                    "INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    rows,
                )
                self.con.execute("COMMIT")
            except Exception:
                self.con.execute("ROLLBACK")
                raise

    # ── file / scope helpers ────────────────────────────────────────────────

    def distinct_files(self) -> list[str]:
        return [
            r[0] for r in self.con.execute(
                "SELECT DISTINCT source_file FROM events ORDER BY source_file"
            ).fetchall()
        ]

    def resolve_files(self, partial: str) -> list[str]:
        """Resolve a partial filename to matching source_file paths.

        `partial` is compared in Python (never sent to SQL), so it can't inject.
        Lets a UI accept "build_047" instead of an absolute path.
        """
        return [f for f in self.distinct_files() if partial in f]

    def list_files(self) -> list[dict]:
        rows = self.con.execute("""
            SELECT source_file,
                   COUNT(*)                                   AS total_events,
                   SUM(CASE WHEN ignored THEN 1 ELSE 0 END)   AS ignored_events,
                   MIN(timestamp)                             AS earliest,
                   MAX(timestamp)                             AS latest
            FROM events
            GROUP BY source_file
            ORDER BY earliest
        """).fetchall()
        return [
            {
                "source_file": r[0], "name": Path(r[0]).name,
                "total_events": r[1], "ignored_events": int(r[2] or 0),
                "earliest": _iso(r[3]), "latest": _iso(r[4]),
            }
            for r in rows
        ]

    # ── overview queries ─────────────────────────────────────────────────────

    def level_counts(
        self, source_file: SourceFileArg = None, include_ignored: bool = False
    ) -> dict[str, int]:
        clause, params = _source_file_clause(source_file)
        active = "" if include_ignored else "AND ignored = false"
        rows = self.con.execute(
            f"""
            SELECT level, COUNT(*) AS n
            FROM events
            WHERE 1 = 1 {active} {clause}
            GROUP BY level
            ORDER BY n DESC
            """,
            params,
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    def top_templates(
        self, n: int = 20, source_file: SourceFileArg = None, include_ignored: bool = False
    ) -> list[dict]:
        clause, params = _source_file_clause(source_file)
        active = "" if include_ignored else "AND e.ignored = false"
        rows = self.con.execute(
            f"""
            SELECT e.template_id, t.template,
                   COUNT(*)                       AS count,
                   COUNT(DISTINCT e.source_file)  AS file_count
            FROM events e
            LEFT JOIN templates t ON e.template_id = t.template_id
            WHERE e.template_id IS NOT NULL {active} {clause}
            GROUP BY e.template_id, t.template
            ORDER BY count DESC
            LIMIT ?
            """,
            params + [n],
        ).fetchall()
        return [
            {"rank": i + 1, "template_id": r[0], "template": r[1],
             "count": r[2], "file_count": r[3]}
            for i, r in enumerate(rows)
        ]

    def template_summary(self, source_file: SourceFileArg = None) -> list[dict]:
        """Every known template with its true event count (from events)."""
        clause, params = _source_file_clause(source_file)
        rows = self.con.execute(
            f"""
            SELECT t.template_id, t.template,
                   COUNT(e.template_id)           AS total_events,
                   COUNT(DISTINCT e.source_file)  AS file_count
            FROM templates t
            LEFT JOIN events e
                   ON t.template_id = e.template_id AND e.ignored = false {clause}
            GROUP BY t.template_id, t.template
            ORDER BY total_events DESC
            """,
            params,
        ).fetchall()
        return [
            {"template_id": r[0], "template": r[1],
             "total_events": r[2], "file_count": r[3]}
            for r in rows
        ]

    def tag_summary(self, source_file: SourceFileArg = None) -> dict:
        clause, params = _source_file_clause(source_file)
        tag_rows = self.con.execute(
            f"""
            SELECT tags, COUNT(*) AS n
            FROM events
            WHERE ignored = false AND tags != '[]' {clause}
            GROUP BY tags
            ORDER BY n DESC
            """,
            params,
        ).fetchall()
        ignored_clause, ignored_params = _source_file_clause(source_file)
        ignored_count = self.con.execute(
            f"SELECT COUNT(*) FROM events WHERE ignored = true {ignored_clause}",
            ignored_params,
        ).fetchone()[0]

        # collapse the JSON-array strings into a per-tag total
        per_tag: dict[str, int] = {}
        for tags_raw, n in tag_rows:
            for tag in json.loads(tags_raw):
                per_tag[tag] = per_tag.get(tag, 0) + n
        return {
            "ignored": ignored_count,
            "tags": [
                {"tag": t, "count": c}
                for t, c in sorted(per_tag.items(), key=lambda kv: kv[1], reverse=True)
            ],
        }

    # ── event listings ───────────────────────────────────────────────────────

    def _events(self, where: str, params: list) -> list[dict]:
        """Shared event-listing shape used by the deep-dive queries."""
        rows = self.con.execute(
            f"""
            SELECT source_file, line_start, timestamp, level, logger,
                   message, stack_trace, template_id, tags
            FROM events
            {where}
            ORDER BY timestamp
            """,
            params,
        ).fetchall()
        return [
            {
                "source_file": r[0], "line_start": r[1], "timestamp": _iso(r[2]),
                "level": r[3], "logger": r[4], "message": r[5],
                "stack_trace": r[6], "template_id": r[7],
                "tags": json.loads(r[8]) if r[8] else [],
            }
            for r in rows
        ]

    def fatal_events(self, source_file: SourceFileArg = None) -> list[dict]:
        clause, params = _source_file_clause(source_file)
        levels = ", ".join("?" for _ in FATAL_LEVELS)
        where = (f"WHERE ignored = false AND level IN ({levels}) {clause}")
        return self._events(where, list(FATAL_LEVELS) + params)

    def stack_traces(self, source_file: SourceFileArg = None) -> list[dict]:
        clause, params = _source_file_clause(source_file)
        where = f"WHERE ignored = false AND stack_trace IS NOT NULL {clause}"
        return self._events(where, params)

    def by_level(self, level: str, source_file: SourceFileArg = None) -> list[dict]:
        clause, params = _source_file_clause(source_file)
        where = f"WHERE ignored = false AND level = ? {clause}"
        return self._events(where, [level.upper()] + params)

    def by_logger(self, pattern: str, source_file: SourceFileArg = None) -> list[dict]:
        """Events whose logger contains `pattern` (case-insensitive)."""
        clause, params = _source_file_clause(source_file)
        where = f"WHERE ignored = false AND lower(logger) LIKE lower(?) {clause}"
        return self._events(where, [f"%{pattern}%"] + params)

    def by_tag(self, tag: str, source_file: SourceFileArg = None) -> list[dict]:
        """Events carrying `tag`. Tags are a JSON-array string like '["x"]';
        the quoted substring match is exact enough that "ssh" won't match
        "ssh-failure". The tag is a bound parameter, not interpolated."""
        clause, params = _source_file_clause(source_file)
        where = f"WHERE ignored = false AND tags LIKE ? {clause}"
        return self._events(where, [f'%"{tag}"%'] + params)

    def by_template(self, template_id: int, source_file: SourceFileArg = None) -> dict:
        """All events for one template, plus a per-file occurrence breakdown."""
        clause, params = _source_file_clause(source_file)
        where = f"WHERE ignored = false AND template_id = ? {clause}"
        events = self._events(where, [template_id] + params)

        tmpl_row = self.con.execute(
            "SELECT template FROM templates WHERE template_id = ?", [template_id]
        ).fetchone()
        template_str = tmpl_row[0] if tmpl_row else None

        per_file: dict[str, int] = {}
        for e in events:
            per_file[e["source_file"]] = per_file.get(e["source_file"], 0) + 1

        return {
            "template_id": template_id,
            "template": template_str,
            "count": len(events),
            "per_file": [
                {"source_file": f, "name": Path(f).name, "count": c}
                for f, c in sorted(per_file.items(), key=lambda kv: kv[1], reverse=True)
            ],
            "events": events,
        }

    # ── time window ──────────────────────────────────────────────────────────

    def time_filter(
        self, lo: Optional[str] = None, hi: Optional[str] = None,
        hours: Optional[float] = None, source_file: SourceFileArg = None,
    ) -> dict:
        """Active events in a time range, anchored to the data (not wall clock).
 
        Bounds are resolved in this order:
          * lo given            -> use it (ISO or Jenkins timestamp string)
          * else hours given    -> lo = hi_end - `hours`  ("last X hours of data")
          * else hi given       -> lo = earliest event in scope
          * else (nothing)      -> lo = hi_end - 12h        (default window)
        where hi_end = parse(hi) if hi else the latest event in scope. So
        time_filter(hours=6) is the last 6h of data within scope. Empty scope
        returns an empty result instead of crashing on None arithmetic.
        """
        clause, scope_params = _source_file_clause(source_file)
        data_min, data_max = self.con.execute(
            f"SELECT MIN(timestamp), MAX(timestamp) FROM events WHERE 1 = 1 {clause}",
            scope_params,
        ).fetchone()
 
        if data_max is None:  # nothing in scope — don't do None - timedelta
            return {"lo": None, "hi": None, "count": 0, "events": []}
 
        hi_dt = parse_timestamp(hi) if hi else data_max
        if lo is not None:
            lo_dt = parse_timestamp(lo)
        elif hours is not None:
            lo_dt = hi_dt - timedelta(hours=hours)
        elif hi is not None:
            lo_dt = data_min
        else:
            lo_dt = data_max - timedelta(hours=12)
 
        where = f"WHERE ignored = false AND timestamp BETWEEN ? AND ? {clause}"
        events = self._events(where, [lo_dt, hi_dt] + scope_params)
        return {"lo": _iso(lo_dt), "hi": _iso(hi_dt), "count": len(events), "events": events}

    # ── cross-file correlation ───────────────────────────────────────────────

    def cross_file_templates(
        self, min_files: int = 2, source_file: SourceFileArg = None
    ) -> list[dict]:
        """Templates appearing in >= min_files distinct files, with per-file
        counts. Single grouped query (no per-template N+1 round trips)."""
        clause, params = _source_file_clause(source_file)
        rows = self.con.execute(
            f"""
            SELECT e.template_id, t.template, e.source_file, COUNT(*) AS n
            FROM events e
            LEFT JOIN templates t ON e.template_id = t.template_id
            WHERE e.ignored = false AND e.template_id IS NOT NULL {clause}
            GROUP BY e.template_id, t.template, e.source_file
            """,
            params,
        ).fetchall()

        agg: dict[int, dict] = {}
        for tid, tmpl, fpath, n in rows:
            slot = agg.setdefault(
                tid, {"template_id": tid, "template": tmpl, "total": 0, "per_file": []}
            )
            slot["total"] += n
            slot["per_file"].append({"source_file": fpath, "name": Path(fpath).name, "count": n})

        result = [s for s in agg.values() if len(s["per_file"]) >= min_files]
        for s in result:
            s["file_count"] = len(s["per_file"])
            s["per_file"].sort(key=lambda pf: pf["count"], reverse=True)
        result.sort(key=lambda s: (s["file_count"], s["total"]), reverse=True)
        return result

    def file_comparison(self, file_a: str, file_b: str) -> dict:
        """Template frequency comparison between exactly two files:
        shared (with signed diff), only-in-A, only-in-B."""
        def counts_for(path: str) -> dict[int, dict]:
            rows = self.con.execute(
                """
                SELECT e.template_id, t.template, COUNT(*) AS n
                FROM events e
                LEFT JOIN templates t ON e.template_id = t.template_id
                WHERE e.ignored = false AND e.template_id IS NOT NULL AND e.source_file = ?
                GROUP BY e.template_id, t.template
                """,
                [path],
            ).fetchall()
            return {r[0]: {"template": r[1], "count": r[2]} for r in rows}

        a, b = counts_for(file_a), counts_for(file_b)
        ids_a, ids_b = set(a), set(b)

        shared = [
            {"template_id": tid, "template": a[tid]["template"],
             "count_a": a[tid]["count"], "count_b": b[tid]["count"],
             "diff": b[tid]["count"] - a[tid]["count"]}
            for tid in sorted(ids_a & ids_b,
                              key=lambda t: a[t]["count"] + b[t]["count"], reverse=True)
        ]
        only_a = [
            {"template_id": tid, "template": a[tid]["template"], "count": a[tid]["count"]}
            for tid in sorted(ids_a - ids_b, key=lambda t: a[t]["count"], reverse=True)
        ]
        only_b = [
            {"template_id": tid, "template": b[tid]["template"], "count": b[tid]["count"]}
            for tid in sorted(ids_b - ids_a, key=lambda t: b[t]["count"], reverse=True)
        ]
        return {
            "file_a": file_a, "name_a": Path(file_a).name,
            "file_b": file_b, "name_b": Path(file_b).name,
            "shared": shared, "only_a": only_a, "only_b": only_b,
        }

    def template_trend(
        self, template_id: int, source_file: SourceFileArg = None
    ) -> dict:
        """Per-file frequency of one template, ordered by each file's earliest
        timestamp. Files with zero occurrences are included so gaps show."""
        clause, params = _source_file_clause(source_file)

        # every file in scope, chronologically by first event
        all_files = self.con.execute(
            f"""
            SELECT source_file, MIN(timestamp) AS first_ts
            FROM events WHERE 1 = 1 {clause}
            GROUP BY source_file ORDER BY first_ts
            """,
            params,
        ).fetchall()

        counts = dict(self.con.execute(
            f"""
            SELECT source_file, COUNT(*) AS n
            FROM events
            WHERE ignored = false AND template_id = ? {clause}
            GROUP BY source_file
            """,
            [template_id] + params,
        ).fetchall())

        tmpl_row = self.con.execute(
            "SELECT template FROM templates WHERE template_id = ?", [template_id]
        ).fetchone()

        return {
            "template_id": template_id,
            "template": tmpl_row[0] if tmpl_row else None,
            "files": [
                {"source_file": f, "name": Path(f).name,
                 "first_ts": _iso(first_ts), "count": counts.get(f, 0)}
                for f, first_ts in all_files
            ],
        }

    def close(self) -> None:
        self.con.close()


# --------------------------------------------------------------------------- #
# Ingestion helpers
# --------------------------------------------------------------------------- #

def ingest_file(
    path: Path | str,
    store: EventStore,
    rules: Optional[list[dict]] = None,
    persistence_path: Optional[Path] = None,
    force: bool = False,
) -> list[LogEvent]:
    """Parse a file, assign drain3 templates, apply rules, write to the store.

    Skips files already in the store unless force=True. persistence_path
    overrides the drain3 snapshot location (defaults to DEFAULT_DRAIN_STATE,
    shared across files so template IDs stay consistent).
    """
    if Path(path).is_dir():
        raise IsADirectoryError(
            f"{path!r} is a directory. Use ingest_all() to ingest every log in a folder."
        )
    source_file = str(Path(path).resolve())
    if not force and store.already_ingested(source_file):
        warnings.warn(f"{source_file!r} already in store, skipping (force=True to re-ingest)")
        return []

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    events = JenkinsLogParser().parse(text)
    extractor = TemplateExtractor(persistence_path=persistence_path)
    extractor.assign(events)
    if rules:
        RuleSet.from_list(rules).apply(events)

    n = store.ingest(events, source_file, miner=extractor.miner)
    print(f"ingested {n} events from {Path(path).name!r}")
    return events


def resolve_log_paths(
    inputs: list[str], patterns: tuple[str, ...] = ("*.log", "*.log.*", "*.crash"),
) -> list[Path]:
    """Expand CLI args (files and/or directories) into concrete log paths.

    Directories are globbed non-recursively. The default patterns cover plain
    `*.log`, rotated names like `jenkins.log.24052026`, and `*.crash` files —
    a plain `*.log` glob would silently miss the last two. De-duplicated,
    sorted for stable ordering. Raises FileNotFoundError on a bad path.
    """
    resolved: list[Path] = []
    seen: set[Path] = set()
    for raw in inputs:
        p = Path(raw).resolve()
        if not p.exists():
            raise FileNotFoundError(f"No such file or directory: {raw}")
        if p.is_dir():
            matches: set[Path] = set()
            for pat in patterns:
                matches.update(p.glob(pat))
            if not matches:
                print(f"  warning: no log files ({', '.join(patterns)}) in {p}")
            for m in sorted(matches):
                if m not in seen:
                    resolved.append(m); seen.add(m)
        else:
            if p not in seen:
                resolved.append(p); seen.add(p)
    return resolved


def ingest_all(
    inputs: Union[str, Path, list],
    store: EventStore,
    rules: Optional[list[dict]] = None,
    persistence_path: Optional[Path] = None,
    force: bool = False,
    patterns: tuple[str, ...] = ("*.log", "*.log.*", "*.crash"),
) -> dict:
    """Ingest one or more files and/or folders.

    `inputs` may be a single path or a list of paths, and any of them may be a
    directory — every matching log inside it (non-recursive, see `patterns`)
    is ingested. Already-loaded files are skipped unless force=True. All files
    share one drain3 state so template IDs stay consistent across them.

    Returns a small summary: {"files": [...], "events": <total inserted>}.
    """
    if isinstance(inputs, (str, Path)):
        inputs = [str(inputs)]
    else:
        inputs = [str(x) for x in inputs]

    paths = resolve_log_paths(inputs, patterns=patterns)
    total, loaded = 0, []
    for p in paths:
        events = ingest_file(p, store, rules=rules,
                             persistence_path=persistence_path, force=force)
        if events:
            loaded.append(str(p))
            total += len(events)
    return {"files": loaded, "events": total}


def load_rules(rules_path: Optional[str]) -> Optional[list[dict]]:
    """Load and validate a rules JSON file for RuleSet.from_list()."""
    if rules_path is None:
        return None
    path = Path(rules_path)
    if not path.exists():
        raise FileNotFoundError(f"Rules file not found: {path}")
    try:
        rules = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Rules file is not valid JSON: {path}\n  {e}")
    if not isinstance(rules, list):
        raise ValueError(f"Rules file must be a JSON array, got {type(rules).__name__}")
    valid = {"ignore", "tag", "set_level"}
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ValueError(f"Rule #{i} is not an object: {rule!r}")
        if "name" not in rule:
            raise ValueError(f"Rule #{i} missing 'name': {rule!r}")
        action = rule.get("action", "ignore")
        if action not in valid:
            raise ValueError(f"Rule '{rule.get('name')}' invalid action '{action}'")
        if action == "tag" and not rule.get("tag"):
            raise ValueError(f"Rule '{rule.get('name')}' action=tag needs 'tag'")
        if action == "set_level" and not rule.get("set_level"):
            raise ValueError(f"Rule '{rule.get('name')}' action=set_level needs 'set_level'")
    return rules


# --------------------------------------------------------------------------- #
# Optional interactive shell (dev convenience)
# --------------------------------------------------------------------------- #

def run_interactive_shell(store: EventStore) -> None:
    """Minimal REPL for ad-hoc SQL and a few dot-commands. Read-only against
    the same DB the webapp would serve from — handy for debugging."""
    print("\n── Interactive SQL shell ──  (.help, .quit)\n")
    con = store.con
    buffer: list[str] = []
    while True:
        try:
            line = input("sql> " if not buffer else "...> ")
        except (EOFError, KeyboardInterrupt):
            print(); break
        s = line.strip()
        if not buffer and s.startswith("."):
            parts = s.split()
            cmd, cargs = parts[0].lower(), parts[1:]
            if cmd in (".quit", ".exit"):
                break
            elif cmd in (".help", ".h", "?"):
                print("  .files | .counts [file] | .compare <a> <b> | .quit\n"
                      "  or type SQL ending in ;")
            elif cmd == ".files":
                for f in store.list_files():
                    print(f"  {f['total_events']:>7}  {f['source_file']}")
            elif cmd == ".counts":
                scope = None
                if cargs:
                    m = store.resolve_files(cargs[0])
                    if len(m) != 1:
                        print(f"  {'no' if not m else 'ambiguous'} match for {cargs[0]!r}"); continue
                    scope = m[0]
                for lvl, n in store.level_counts(scope).items():
                    print(f"  {lvl:<10} {n:>7}")
            elif cmd == ".compare" and len(cargs) == 2:
                ma, mb = store.resolve_files(cargs[0]), store.resolve_files(cargs[1])
                if len(ma) != 1 or len(mb) != 1:
                    print("  each pattern must match exactly one file"); continue
                cmp = store.file_comparison(ma[0], mb[0])
                print(f"  shared={len(cmp['shared'])} only_a={len(cmp['only_a'])} only_b={len(cmp['only_b'])}")
            else:
                print("  unknown command (.help)")
            continue
        buffer.append(line)
        full = " ".join(buffer).strip()
        if not full.endswith(";"):
            continue
        query, buffer = full[:-1], []
        try:
            res = con.execute(query)
            if res.description:
                cols = [d[0] for d in res.description]
                print("  " + " | ".join(cols))
                for row in res.fetchall():
                    print("  " + " | ".join("NULL" if v is None else str(v)[:60] for v in row))
            else:
                print("  OK")
        except Exception as e:
            print(f"  Error: {e}")
    print("bye")


# --------------------------------------------------------------------------- #
# Ingestion CLI
# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest Jenkins logs into the DuckDB store")
    ap.add_argument("log_files", nargs="+", help="Log files and/or directories")
    ap.add_argument("--db", default=str(DEFAULT_DB_PATH), help="DuckDB path")
    ap.add_argument("--rules", metavar="PATH", help="JSON rules file")
    ap.add_argument("--force", action="store_true", help="Re-ingest already-loaded files")
    ap.add_argument("--shell", action="store_true", help="Drop into an SQL shell after ingest")
    args = ap.parse_args()

    try:
        rules = load_rules(args.rules)
    except (FileNotFoundError, ValueError) as e:
        ap.error(str(e))

    store = EventStore(args.db)
    print(f"Database: {args.db}\nDRAIN3 state: {DEFAULT_DRAIN_STATE}")
    try:
        ingest_all(args.log_files, store, rules=rules, force=args.force)
    except FileNotFoundError as e:
        ap.error(str(e))

    print("\nLevel counts:", store.level_counts())
    print("Top templates:")
    for t in store.top_templates(5):
        print(f"  #{t['template_id']:>2} x{t['count']:<6} files={t['file_count']}  {str(t['template'])[:60]}")
    xf = store.cross_file_templates(min_files=2)
    print(f"Cross-file templates (>=2 files): {len(xf)}")

    if args.shell:
        run_interactive_shell(store)
    store.close()


if __name__ == "__main__":
    main()
