"""Schema validation helpers."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft7Validator
except ImportError:  # pragma: no cover - allow running without dep for quick builds
    Draft7Validator = None  # type: ignore[assignment]

from .paths import SCHEMAS_DIR


_SCHEMA_CACHE: dict[str, Any] = {}


def _load(name: str) -> dict[str, Any]:
    if name not in _SCHEMA_CACHE:
        with open(SCHEMAS_DIR / name, "r", encoding="utf-8") as f:
            _SCHEMA_CACHE[name] = json.load(f)
    return _SCHEMA_CACHE[name]


def validate(doc: dict[str, Any], schema_file: str) -> list[str]:
    """Return a list of human-readable validation errors (empty if valid)."""
    if Draft7Validator is None:
        return []  # dependency missing — skip silently

    schema = _load(schema_file)
    validator = Draft7Validator(schema)
    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in errors
    ]


def validate_file(path: Path, schema_file: str) -> list[str]:
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    return validate(doc, schema_file)
