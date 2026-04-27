"""Retrieval logic for the fixture project."""

from __future__ import annotations
from .models import Memory
from .store import MemoryStore


def recall(store: MemoryStore, query: str, max_results: int = 10) -> list[Memory]:
    """Return memories matching the query, sorted by heat descending."""
    results = [
        m for m in store.get_hot(min_heat=0.0)
        if query.lower() in m.content.lower()
    ]
    results.sort(key=lambda m: m.heat, reverse=True)
    return results[:max_results]


def recall_by_domain(
    store: MemoryStore,
    query: str,
    domain: str,
    max_results: int = 10,
) -> list[Memory]:
    """Return memories filtered by domain and matching the query."""
    all_results = recall(store, query, max_results=max_results * 2)
    filtered = [m for m in all_results if m.domain == domain]
    return filtered[:max_results]


def fuse_scores(
    semantic_score: float,
    recency_score: float,
    heat_score: float,
    weights: tuple[float, float, float] = (0.5, 0.3, 0.2),
) -> float:
    """Weighted reciprocal rank fusion of three signals."""
    ws, wr, wh = weights
    return ws * semantic_score + wr * recency_score + wh * heat_score
