"""Consolidation cycles for the fixture project."""

from __future__ import annotations
from .store import MemoryStore


def run_decay(store: MemoryStore, factor: float = 0.95) -> dict:
    """Run a heat decay cycle. Returns diagnostic dict."""
    count = store.decay_all(factor)
    return {
        "stage": "decay",
        "memories_processed": count,
        "factor": factor,
    }


def run_compression(store: MemoryStore, cold_threshold: float = 0.1) -> dict:
    """Compress cold memories to tags. Stub for fixture purposes."""
    cold_count = sum(1 for m in store.get_hot(min_heat=0.0) if m.heat < cold_threshold)
    return {
        "stage": "compress",
        "cold_memories": cold_count,
        "compressed": 0,
    }


def run_full_cycle(store: MemoryStore) -> dict:
    """Run decay then compress. Returns combined diagnostics."""
    decay_result = run_decay(store)
    compress_result = run_compression(store)
    return {
        "decay": decay_result,
        "compress": compress_result,
        "status": "ok",
    }
