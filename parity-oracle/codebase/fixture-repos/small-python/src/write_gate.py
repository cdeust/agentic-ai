"""Predictive-coding write gate for the fixture project.

source: Friston (2010) free-energy minimization — novel content (high
prediction error) passes; redundant content (low prediction error) is
rejected or merged.
"""

from __future__ import annotations


MIN_NOVELTY_THRESHOLD: float = 0.15
MERGE_SIMILARITY_THRESHOLD: float = 0.85


def evaluate_novelty(
    content: str,
    existing_contents: list[str],
) -> tuple[float, str]:
    """Evaluate novelty of content vs existing stored memories.

    Returns (novelty_score, gate_reason) where novelty_score in [0, 1].
    High score = novel = should store. Low score = redundant = reject.
    """
    if not existing_contents:
        return (1.0, "empty_store")

    # Simplified: use word overlap as a proxy for semantic similarity
    content_words = set(content.lower().split())
    max_overlap = 0.0
    for existing in existing_contents:
        existing_words = set(existing.lower().split())
        if not content_words and not existing_words:
            continue
        union = content_words | existing_words
        if union:
            overlap = len(content_words & existing_words) / len(union)
            max_overlap = max(max_overlap, overlap)

    novelty = 1.0 - max_overlap
    if novelty < MIN_NOVELTY_THRESHOLD:
        return (novelty, "redundant_low_novelty")
    return (novelty, "novel")


def should_store(novelty_score: float, force: bool = False) -> bool:
    """Decide whether to store based on novelty score."""
    if force:
        return True
    return novelty_score >= MIN_NOVELTY_THRESHOLD


def build_rejection_response(novelty_score: float, gate_reason: str) -> dict:
    """Build the rejection response dict."""
    return {
        "stored": False,
        "action": "rejected",
        "reason": gate_reason,
        "novelty": round(novelty_score, 4),
    }
