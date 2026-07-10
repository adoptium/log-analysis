"""
test_log_store.py — test suite for the merged log_store.

Two modes:

  1. Default (no arguments) — the self-contained regression suite. Generates its
     own synthetic Jenkins logs and checks results against known-exact numbers.

         python test_log_store.py

  2. Smoke mode (--logs) — ingest YOUR real logs and run only the checks that
     hold for any data: no template fragmentation, SQL injection blocked, the
     empty-scope guard, correct source_file scoping, cross-file consistency
     (when 2+ files), and JSON-serializable output. It does NOT assert specific
     counts, because it can't know them for arbitrary logs.

         python test_log_store.py --logs jenkins.log jenkins_log.crash
         python test_log_store.py --logs ./logs/              # a folder works too
         python test_log_store.py --logs jenkins.log --rules rules.json

Both modes use a temp database and temp drain3 state, so they never touch your
real jenkins_logs.duckdb / drain3_state.bin. Exit code is 0 only if everything
passes, so either mode works in CI.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import tempfile
import warnings
from pathlib import Path

from log_store import EventStore, ingest_all, load_rules

warnings.simplefilter("ignore")  # quiet the "already ingested" UserWarnings

PASS, FAIL = 0, 0
EVIL = "x' OR '1'='1"  # a classic SQL-injection probe for the source_file filter


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


# --------------------------------------------------------------------------- #
# Data-independent checks — reused by both the synthetic suite and smoke mode.
# Every assertion here holds for ANY set of logs.
# --------------------------------------------------------------------------- #

def check_no_fragmentation(store: EventStore) -> None:
    print("\n[fragmentation] one row per template_id, counts whole")
    tt = store.top_templates(50)
    ids = [r["template_id"] for r in tt]
    check("no duplicate template_id rows", len(ids) == len(set(ids)), f"ids={ids[:10]}...")
    ok = True
    for r in tt:
        raw = store.con.execute(
            "SELECT COUNT(*) FROM events WHERE template_id = ? AND ignored = false",
            [r["template_id"]],
        ).fetchone()[0]
        if r["count"] != raw:
            ok = False
            print(f"       template #{r['template_id']}: top={r['count']} raw={raw}")
    check("top-template counts equal raw active counts (not split)", ok)


def check_injection(store: EventStore) -> None:
    print("\n[injection] filter cannot be bypassed")
    allc = sum(store.level_counts(None).values())
    check("there is data a bypass could leak", allc > 0, f"all={allc}")
    check("injected scope returns 0 rows (not all)",
          sum(store.level_counts(EVIL).values()) == 0)
    methods = {
        "top_templates": lambda: store.top_templates(10, EVIL),
        "template_summary": lambda: [r for r in store.template_summary(EVIL) if r["total_events"] > 0],
        "fatal_events": lambda: store.fatal_events(EVIL),
        "stack_traces": lambda: store.stack_traces(EVIL),
        "by_level": lambda: store.by_level("WARNING", EVIL),
        "by_logger": lambda: store.by_logger("a", EVIL),
        "by_tag": lambda: store.by_tag("anything", EVIL),
        "time_filter": lambda: store.time_filter(source_file=EVIL)["events"],
        "cross_file_templates": lambda: store.cross_file_templates(2, EVIL),
        "template_trend": lambda: [f for f in store.template_trend(1, EVIL)["files"]],
    }
    for name, fn in methods.items():
        check(f"injection blocked in {name}", len(fn()) == 0)
    check("injection blocked in by_template", store.by_template(1, EVIL)["count"] == 0)


def check_empty_scope(store: EventStore) -> None:
    print("\n[empty scope] no crash on a scope that matches nothing")
    r = store.time_filter(source_file="/no/such/file.log")
    check("empty-scope time_filter returns empty",
          r == {"lo": None, "hi": None, "count": 0, "events": []}, str(r))


def check_scoping(store: EventStore) -> None:
    print("\n[scoping] source_file shapes agree")
    files = store.distinct_files()
    allc = sum(store.level_counts(None).values())
    per_file_total = sum(sum(store.level_counts(f).values()) for f in files)
    check("sum of per-file scopes == all files", per_file_total == allc, f"{per_file_total} vs {allc}")
    check("explicit full file list == all", sum(store.level_counts(files).values()) == allc)
    check("empty list [] matches nothing", sum(store.level_counts([]).values()) == 0)
    if files:
        check("single-file scope <= all", sum(store.level_counts(files[0]).values()) <= allc)


def check_cross_file(store: EventStore) -> None:
    files = store.distinct_files()
    if len(files) < 2:
        print("\n[cross-file] skipped (needs 2+ files)")
        return
    print("\n[cross-file] correlation is internally consistent")
    xf = store.cross_file_templates(min_files=2)
    check("all cross-file templates span >= 2 files", all(r["file_count"] >= 2 for r in xf))
    check("per_file counts sum to total",
          all(r["total"] == sum(p["count"] for p in r["per_file"]) for r in xf))
    cmp = store.file_comparison(files[0], files[1])
    check("comparison diff == count_b - count_a",
          all(s["diff"] == s["count_b"] - s["count_a"] for s in cmp["shared"]))


def check_json_serializable(store: EventStore) -> None:
    print("\n[json] every endpoint payload is json.dumps-able")
    files = store.distinct_files()
    top = store.top_templates(1)
    tid = top[0]["template_id"] if top else 1
    payloads = {
        "list_files": store.list_files(),
        "level_counts": store.level_counts(),
        "top_templates": store.top_templates(5),
        "template_summary": store.template_summary(),
        "tag_summary": store.tag_summary(),
        "fatal_events": store.fatal_events(),
        "by_template": store.by_template(tid),
        "time_filter": store.time_filter(),
        "cross_file_templates": store.cross_file_templates(2),
        "template_trend": store.template_trend(tid),
    }
    if len(files) >= 2:
        payloads["file_comparison"] = store.file_comparison(files[0], files[1])
    ok = True
    for name, p in payloads.items():
        try:
            json.dumps(p)
        except TypeError as e:
            ok = False
            print(f"       {name} not serializable: {e}")
    check("all payloads json.dumps-able", ok)


def run_data_independent(store: EventStore) -> None:
    """The checks that hold for any logs — used by both modes."""
    check_no_fragmentation(store)
    check_injection(store)
    check_empty_scope(store)
    check_scoping(store)
    check_cross_file(store)
    check_json_serializable(store)


# --------------------------------------------------------------------------- #
# Smoke mode — ingest the user's real logs, then run the invariants above.
# --------------------------------------------------------------------------- #

def run_smoke_suite(paths: list[str], rules_path) -> None:
    tmp = Path(tempfile.mkdtemp(prefix="logstore_smoke_"))
    db, state = tmp / "smoke.duckdb", tmp / "smoke.drain3.bin"
    rules = load_rules(rules_path)

    print(f"Smoke test on: {', '.join(paths)}")
    store = EventStore(db)
    summary = ingest_all(paths, store, rules=rules, persistence_path=state)

    n_events = summary["events"]
    n_files = len(summary["files"])
    n_tmpl = store.con.execute("SELECT COUNT(*) FROM templates").fetchone()[0]
    print(f"\ningested {n_events:,} events from {n_files} file(s), {n_tmpl} templates")
    check("ingestion produced events", n_events > 0, "nothing ingested — check your paths")
    if n_events == 0:
        store.close()
        return

    run_data_independent(store)
    store.close()
    print(f"\n(temp workspace: {tmp})")


# --------------------------------------------------------------------------- #
# Synthetic suite — self-contained, with exact-count assertions.
# --------------------------------------------------------------------------- #

def _hdr(ts, tid, level, logger, method, msg) -> str:
    return f"{ts} [id={tid}]\t{level}\t{logger}#{method}: {msg}"


def make_logs(dirpath: Path) -> None:
    """Write build_may.log, build_june.log and a rotated-name log."""
    random.seed(7)
    may = []
    for i in range(200):
        ip = f"10.0.{random.randint(0,255)}.{random.randint(0,255)}"
        may.append(_hdr(f"2026-05-18 03:{20+i//60:02d}:{i%60:02d}.{i%1000:03d}+0000",
                        581000 + i, "WARNING", "h.plugins.sshslaves.SSHLauncher", "log",
                        f"SSH Launch of test-mac-1 on {ip} failed in {random.randint(1000,9000)} ms"))
    may += [_hdr("2026-05-18 03:40:00.000+0000", 999001, "SEVERE", "hudson.model.Run", "execute",
                 "Build step failed"),
            "hudson.AbortException: Cannot resume build",
            "\tat hudson.model.Run.execute(Run.java:1899)"]
    for i in range(300):
        may.append(_hdr(f"2026-05-18 04:{i//60:02d}:{i%60:02d}.000+0000", 700000 + i,
                        "INFO", "o.e.j.s.h.ContextHandler", "log",
                        "While serving /job/x/api/json: hudson.security.AccessDeniedException3: "
                        "anonymous is missing the Job/Build permission"))
    (dirpath / "build_may.log").write_text("\n".join(may) + "\n")

    jun = []
    hosts = [f"test-agent-{n}-x64-1" for n in range(40)]
    for i in range(2000):
        ip = f"10.1.{random.randint(0,255)}.{random.randint(0,255)}"
        jun.append(_hdr(f"2026-06-02 22:{10+i//120:02d}:{i%60:02d}.{i%1000:03d}+0000",
                        581000 + i, "WARNING", "h.plugins.sshslaves.SSHLauncher", "log",
                        f"SSH Launch of {random.choice(hosts)} on {ip} failed in {random.randint(1000,9000)} ms"))
    for i in range(500):
        jun.append(_hdr(f"2026-06-03 07:{i//60:02d}:{i%60:02d}.000+0000", 700000 + i,
                        "INFO", "o.e.j.s.h.ContextHandler", "log",
                        "While serving /job/y/api/json: hudson.security.AccessDeniedException3: "
                        "anonymous is missing the Job/Build permission"))
    (dirpath / "build_june.log").write_text("\n".join(jun) + "\n")

    (dirpath / "jenkins.log.24052026").write_text("\n".join(may) + "\n")


def run_synthetic_suite() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="logstore_test_"))
    logs = tmp / "logs"; logs.mkdir()
    make_logs(logs)
    db, state = tmp / "test.duckdb", tmp / "test.drain3.bin"
    rules = [
        {"name": "suppress_scrapers", "action": "ignore", "logger_regex": "ContextHandler"},
        {"name": "tag_ssh", "action": "tag", "logger_regex": "SSHLauncher", "tag": "ssh-failure"},
    ]
    store = EventStore(db)

    print("\n[ingest] folder + rotated-name discovery + idempotency")
    summary = ingest_all(logs, store, rules=rules, persistence_path=state)
    check("folder ingested 3 files", len(summary["files"]) == 3, str(summary["files"]))
    check("rotated jenkins.log.24052026 discovered",
          any("24052026" in f for f in summary["files"]))
    again = ingest_all(logs, store, persistence_path=state)
    check("re-ingest skips already-loaded files", again["events"] == 0, str(again))

    print("\n[exact counts] known synthetic ground truth")
    lc = store.level_counts()
    check("ignore rule removed all INFO", "INFO" not in lc, str(lc))
    ts = store.tag_summary()
    check("ignored count > 0", ts["ignored"] > 0)
    ssh_active = store.con.execute(
        "SELECT COUNT(*) FROM events WHERE lower(logger) LIKE '%sshlauncher%' AND ignored = false"
    ).fetchone()[0]
    check("ssh-failure tag == SSH event count",
          any(t["tag"] == "ssh-failure" and t["count"] == ssh_active for t in ts["tags"]))
    cols = [c[1] for c in store.con.execute("PRAGMA table_info('templates')").fetchall()]
    check("no unreliable cluster_size column", "cluster_size" not in cols, str(cols))

    run_data_independent(store)
    store.close()
    print(f"\n(temp workspace: {tmp})")


def main() -> int:
    ap = argparse.ArgumentParser(description="Test the merged log_store")
    ap.add_argument("--logs", nargs="+", metavar="PATH",
                    help="Real log files and/or folders to smoke-test (skips exact-count checks). "
                         "Omit to run the self-contained synthetic suite.")
    ap.add_argument("--rules", metavar="PATH", help="Optional rules JSON to apply during smoke ingest")
    args = ap.parse_args()

    if args.logs:
        run_smoke_suite(args.logs, args.rules)
    else:
        run_synthetic_suite()

    print(f"\n{'='*40}\n{PASS} passed, {FAIL} failed\n{'='*40}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())