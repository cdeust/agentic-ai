"""In-memory store for fixture project."""

from __future__ import annotations
from typing import Optional
from .models import Memory


class MemoryStore:
    """Simple in-memory store; simulates the persistence layer."""

    def __init__(self) -> None:
        self._memories: dict[int, Memory] = {}
        self._next_id: int = 1

    def insert(self, content: str, heat: float, domain: str) -> Memory:
        """Insert a new memory and return it."""
        mem = Memory(id=self._next_id, content=content, heat=heat, domain=domain)
        self._memories[self._next_id] = mem
        self._next_id += 1
        return mem

    def get(self, memory_id: int) -> Optional[Memory]:
        """Retrieve a memory by ID."""
        return self._memories.get(memory_id)

    def get_hot(self, min_heat: float = 0.5) -> list[Memory]:
        """Return all memories above the heat threshold."""
        return [m for m in self._memories.values() if m.heat >= min_heat]

    def decay_all(self, factor: float = 0.95) -> int:
        """Decay all memories. Returns count updated."""
        count = 0
        for mid, mem in list(self._memories.items()):
            self._memories[mid] = mem.decay(factor)
            count += 1
        return count

    def count(self) -> int:
        """Return total number of stored memories."""
        return len(self._memories)
