"""Thermodynamic heat model for the fixture project."""

from __future__ import annotations
import math


# source: Friston (2010) free-energy framework; heat analogizes free energy
# source: Turrigiano (2008) homeostatic scaling — heat bounded [0, 1]
HOT_THRESHOLD: float = 0.5
COLD_THRESHOLD: float = 0.1
DECAY_RATE: float = 0.05


def compute_initial_heat(importance: float, surprise: float) -> float:
    """Compute initial heat from importance and surprise signals."""
    base = (importance + surprise) / 2.0
    return min(1.0, max(0.0, base))


def apply_surprise_boost(base_heat: float, surprise_score: float, boost: float) -> float:
    """Apply a surprise boost on top of a base heat value."""
    boosted = base_heat + boost * surprise_score
    return min(1.0, max(0.0, boosted))


def effective_heat(stored_heat: float, age_days: float) -> float:
    """Compute effective heat accounting for time decay (lazy evaluation).

    source: Ebbinghaus forgetting curve approximation
    """
    decay = math.exp(-DECAY_RATE * age_days)
    return stored_heat * decay


def compute_valence(content: str) -> float:
    """Estimate emotional valence of content. Returns value in [-1, 1]."""
    negative_words = {"error", "crash", "fail", "bug", "broken", "wrong"}
    positive_words = {"fix", "solved", "decided", "success", "works", "correct"}
    words = set(content.lower().split())
    neg = len(words & negative_words)
    pos = len(words & positive_words)
    total = neg + pos
    if total == 0:
        return 0.0
    return (pos - neg) / total
