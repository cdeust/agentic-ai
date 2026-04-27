"""Narrative generation for the fixture project."""

from __future__ import annotations
from .models import Memory


def generate_brief_summary(memories: list[Memory]) -> str:
    """Generate a one-paragraph executive summary from memories."""
    if not memories:
        return "No memories recorded for this domain."
    hot = [m for m in memories if m.is_hot()]
    count = len(memories)
    hot_count = len(hot)
    top = hot[0].content[:100] if hot else memories[0].content[:100]
    return (
        f"This domain has {count} stored memories, {hot_count} of which are hot. "
        f"The most recent hot memory: {top}..."
    )


def generate_narrative(memories: list[Memory], directory: str = "") -> dict:
    """Generate a multi-section project narrative from memories."""
    if not memories:
        return {
            "narrative": "No memories recorded for this project.",
            "memory_count": 0,
            "themes": [],
        }

    themes = _extract_themes(memories)
    sections = _build_sections(memories, themes)
    narrative_text = "\n\n".join(
        f"## {title}\n{body}" for title, body in sections
    )
    return {
        "narrative": narrative_text,
        "memory_count": len(memories),
        "themes": themes,
    }


def _extract_themes(memories: list[Memory]) -> list[str]:
    keyword_counts: dict[str, int] = {}
    for m in memories:
        for word in m.content.lower().split():
            if len(word) > 5:
                keyword_counts[word] = keyword_counts.get(word, 0) + 1
    sorted_words = sorted(keyword_counts.items(), key=lambda x: x[1], reverse=True)
    return [w for w, _ in sorted_words[:5]]


def _build_sections(
    memories: list[Memory],
    themes: list[str],
) -> list[tuple[str, str]]:
    hot = [m for m in memories if m.is_hot()]
    cold = [m for m in memories if not m.is_hot()]
    sections: list[tuple[str, str]] = []
    if hot:
        body = " ".join(m.content[:60] for m in hot[:3])
        sections.append(("Recent Activity", body))
    if cold:
        sections.append(("Historical Context", f"{len(cold)} older memories archived."))
    return sections
