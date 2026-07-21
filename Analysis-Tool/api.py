"""
FastAPI server for the Eclipse Log Analysis webapp.

Endpoints:
  POST /analyze         - upload a log file + optional rules, returns LogEvent[]
  POST /top-templates   - compute top N templates from events
  POST /in-window       - filter events by time window
  GET  /health          - liveness check
"""

from __future__ import annotations

import json
import tempfile
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from log_store import EventStore

from analyzer import (
    JenkinsLogParser,
    LogEvent,
    RuleSet,
    TemplateExtractor,
    active,
    level_counts,
    parse_timestamp,
)

app = FastAPI(title="Eclipse Log Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = EventStore()


# --------------------------------------------------------------------------- #
# Request / response models
# --------------------------------------------------------------------------- #

class TopTemplatesRequest(BaseModel):
    events: list[dict]
    n: int = 20


class TopTemplateResult(BaseModel):
    rank: int
    template_id: Optional[int]
    count: int
    template: Optional[str]
    example: str


class InWindowRequest(BaseModel):
    events: list[dict]
    center: str
    before_seconds: float
    after_seconds: float


class SaveAnalysisRequest(BaseModel):
    name: str
    events: list[dict]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _dicts_to_events(raw: list[dict]) -> list[LogEvent]:
    """Reconstruct LogEvent objects from the JSON dicts the client sends back."""
    events = []
    for d in raw:
        ev = LogEvent(
            line_start=d.get("line_start", 0),
            line_end=d.get("line_end", 0),
            timestamp_raw=d.get("timestamp_raw"),
            thread_id=d.get("thread_id"),
            level=d.get("level"),
            logger=d.get("logger"),
            method=d.get("method"),
            message=d.get("message", ""),
            stack_trace=d.get("stack_trace"),
            raw=d.get("raw", ""),
            template_id=d.get("template_id"),
            template=d.get("template"),
            tags=d.get("tags", []),
            ignored=d.get("ignored", False),
        )
        ts = d.get("timestamp")
        if ts:
            try:
                ev.timestamp = parse_timestamp(ts)
            except Exception:
                ev.timestamp = None
        events.append(ev)
    return events


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/saved-analyses")
def list_saved_analyses():
    return store.list_files()


@app.post("/saved-analyses")
def save_analysis(body: SaveAnalysisRequest):
    name = (body.name or "").strip() or f"analysis-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
    if not body.events:
        raise HTTPException(status_code=400, detail="No events were supplied")

    events = _dicts_to_events(body.events)
    if not events:
        raise HTTPException(status_code=400, detail="No events were parsed")

    if store.already_ingested(name):
        store.delete_analysis(name)
    store.ingest(events, name)
    return {"name": name, "saved": len(events)}


@app.get("/saved-analyses/{name}")
def load_saved_analysis(name: str):
    events = store.load_events(name)
    if not events:
        raise HTTPException(status_code=404, detail="Saved analysis not found")
    return {"name": name, "events": events, "count": len(events)}


@app.delete("/saved-analyses/{name}")
def delete_saved_analysis(name: str):
    store.delete_analysis(name)
    return {"name": name, "deleted": True}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    rules: str = Form(default="[]"),
):
    """
    Parse an uploaded log file and apply optional rules.
    Returns a list of LogEvent dicts plus level_counts summary.
    """
    try:
        rules_list: list[dict] = json.loads(rules)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="rules must be valid JSON")

    contents = await file.read()
    try:
        text = contents.decode("utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode file: {exc}")

    events: list[LogEvent] = JenkinsLogParser().parse(text)
    TemplateExtractor().assign(events)

    if rules_list:
        try:
            RuleSet.from_list(rules_list).apply(events)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid rule: {exc}")

    return {
        "events": [e.to_dict() for e in events],
        "level_counts": level_counts(events),
        "total": len(events),
        "active": len(active(events)),
        "ignored": sum(1 for e in events if e.ignored),
    }


@app.post("/top-templates", response_model=list[TopTemplateResult])
def get_top_templates(body: TopTemplatesRequest):
    """Return the top N most-frequent templates from the supplied events."""
    events = _dicts_to_events(body.events)
    counts: Counter = Counter()
    sample: dict[int, tuple[Optional[str], str]] = {}

    for ev in active(events):
        if ev.template_id is None:
            continue
        counts[ev.template_id] += 1
        sample.setdefault(ev.template_id, (ev.template, ev.message))

    results = []
    for rank, (tid, count) in enumerate(counts.most_common(body.n), start=1):
        tmpl, msg = sample[tid]
        results.append(
            TopTemplateResult(
                rank=rank,
                template_id=tid,
                count=count,
                template=tmpl,
                example=msg,
            )
        )
    return results


@app.post("/in-window")
def get_in_window(body: InWindowRequest):
    """Return active events within [center - before, center + after]."""
    try:
        center = parse_timestamp(body.center)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid center timestamp: {exc}")

    before = timedelta(seconds=body.before_seconds)
    after = timedelta(seconds=body.after_seconds)
    lo, hi = center - before, center + after

    events = _dicts_to_events(body.events)
    matched = [
        e.to_dict()
        for e in events
        if e.timestamp and lo <= e.timestamp <= hi
    ]
    return {"events": matched, "count": len(matched)}
