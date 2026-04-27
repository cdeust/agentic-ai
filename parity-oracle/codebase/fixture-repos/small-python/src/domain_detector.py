"""Domain detection for the fixture project."""

from __future__ import annotations
from pathlib import Path


_KNOWN_DOMAINS = {
    "cortex": ["/Cortex", "/cortex"],
    "agentic-ai": ["/agentic-ai", "/agentic_ai"],
    "prd-spec-generator": ["/prd-spec-generator", "/prd_spec"],
}


def detect_domain(cwd: str) -> tuple[str, float]:
    """Detect the cognitive domain from a working directory path.

    Returns (domain_name, confidence) where confidence is in [0, 1].
    """
    if not cwd:
        return ("unknown", 0.0)

    path = Path(cwd)
    parts = [p.lower() for p in path.parts]

    for domain, patterns in _KNOWN_DOMAINS.items():
        for pattern in patterns:
            norm = pattern.lower().lstrip("/")
            if norm in parts:
                return (domain, 0.9)

    if len(parts) >= 2:
        return (parts[-1], 0.4)

    return ("unknown", 0.0)


def resolve_domain(hint: str) -> str:
    """Normalize a domain hint to a canonical domain ID."""
    for domain in _KNOWN_DOMAINS:
        if hint.lower() in domain.lower() or domain.lower() in hint.lower():
            return domain
    return hint.lower()
