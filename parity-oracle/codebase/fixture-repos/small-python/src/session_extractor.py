"""Session extraction for the fixture project.

Extracts memorable items from JSONL conversation records.
Mirrors the interface of mcp_server.core.session_extractor.
"""

from __future__ import annotations
from typing import Any


MEMORABLE_KEYWORDS = {
    "decided", "decision", "architecture", "fix", "bug", "error",
    "lesson", "important", "performance", "benchmark", "regression",
}


def extract_memorable_items(
    records: list[dict[str, Any]],
    min_importance: float = 0.4,
) -> list[dict[str, Any]]:
    """Extract memorable items from a session's records.

    Returns list of dicts with: content, tags, importance, timestamp.
    """
    items: list[dict[str, Any]] = []
    for record in records:
        content = _extract_content(record)
        if not content:
            continue
        importance = _score_importance(content)
        if importance < min_importance:
            continue
        tags = _extract_tags(content)
        items.append({
            "content": content,
            "importance": importance,
            "tags": tags,
            "timestamp": record.get("timestamp"),
        })
    return items


def extract_session_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract a summary dict from session records."""
    cwd = ""
    session_id = ""
    for record in records:
        if cwd_val := record.get("cwd"):
            cwd = cwd_val
        if sid := record.get("sessionId"):
            session_id = sid
    return {"cwd": cwd, "session_id": session_id, "record_count": len(records)}


def _extract_content(record: dict[str, Any]) -> str:
    msg = record.get("message", {})
    if isinstance(msg, dict):
        content = msg.get("content", "")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    return item.get("text", "").strip()
    return ""


def _score_importance(content: str) -> float:
    words = set(content.lower().split())
    matches = len(words & MEMORABLE_KEYWORDS)
    return min(1.0, 0.3 + matches * 0.15)


def _extract_tags(content: str) -> list[str]:
    tags: list[str] = []
    lower = content.lower()
    if "error" in lower or "bug" in lower:
        tags.append("bug-fix")
    if "decided" in lower or "decision" in lower or "architecture" in lower:
        tags.append("decision")
    if "performance" in lower or "benchmark" in lower:
        tags.append("performance")
    if "lesson" in lower or "important" in lower:
        tags.append("lesson")
    return tags
