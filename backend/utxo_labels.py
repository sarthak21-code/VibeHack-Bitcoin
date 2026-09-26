"""
Persistent UTXO labels/tags store.

Lets a user tag individual UTXOs with a wallet-side cluster name, a free-text
label, and a "rare/reserve" flag. Labels persist across planner runs in a
small JSON sidecar file next to the wallet database, so tags survive backend
restarts.

This is intentionally simple (no concurrent-write locking beyond an
in-process Lock, no multi-user separation) since the prototype runs as a
single local process for one operator.
"""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Optional

LABELS_PATH = Path(__file__).resolve().parent / "bitcoin" / "utxo_labels.json"

_lock = Lock()


def _read_raw() -> Dict[str, Any]:
    if not LABELS_PATH.exists():
        return {}
    try:
        with LABELS_PATH.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {}


def _write_raw(data: Dict[str, Any]) -> None:
    LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LABELS_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)


def load_labels() -> Dict[str, Dict[str, Any]]:
    """Return {outpoint_str: {cluster, label, rare}} for every tagged UTXO."""
    with _lock:
        return _read_raw()


def set_label(
    outpoint: str,
    cluster: Optional[str],
    label: Optional[str],
    rare: bool,
) -> Dict[str, Any]:
    """Create or overwrite the metadata for one outpoint. Returns the stored entry."""
    with _lock:
        data = _read_raw()
        entry = {
            "cluster": (cluster or "").strip() or None,
            "label": (label or "").strip() or None,
            "rare": bool(rare),
        }
        data[outpoint] = entry
        _write_raw(data)
        return entry


def delete_label(outpoint: str) -> bool:
    """Remove a tag, reverting the UTXO to the default demo metadata. Returns True if it existed."""
    with _lock:
        data = _read_raw()
        if outpoint in data:
            del data[outpoint]
            _write_raw(data)
            return True
        return False


def seed_if_empty(defaults: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    On first run (empty store), seed persisted labels from the built-in demo
    metadata so the app has sensible clusters out of the box. Returns the
    resulting (possibly seeded) label set.
    """
    with _lock:
        data = _read_raw()
        if not data and defaults:
            _write_raw(defaults)
            return dict(defaults)
        return data
