"""Domain models for the fixture project."""

from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Memory:
    """A stored memory entry."""

    id: int
    content: str
    heat: float
    domain: str

    def is_hot(self) -> bool:
        """Return True if heat is above the hot threshold."""
        return self.heat >= 0.5

    def decay(self, factor: float) -> "Memory":
        """Return a new Memory with decayed heat."""
        return Memory(
            id=self.id,
            content=self.content,
            heat=max(0.0, self.heat * factor),
            domain=self.domain,
        )


@dataclass
class Domain:
    """A cognitive domain grouping memories."""

    name: str
    description: str

    def matches(self, path: str) -> bool:
        """Return True if the given path belongs to this domain."""
        return self.name.lower() in path.lower()
