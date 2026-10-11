"""Run context propagation for automatic trace and parent linkage.

``torrix.run_context(...)`` groups every call made inside the block into one
trace and chains parent-child relationships without manual ids, so nested
``torrix.wrap()`` calls build an agent tree on their own.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Dict, Iterator, Optional

_current: ContextVar[Optional[Dict[str, Any]]] = ContextVar("torrix_run_context", default=None)


def current_context() -> Optional[Dict[str, Any]]:
    """Return the active run context, if any (mostly useful in tests/debugging)."""
    return _current.get()


@contextmanager
def run_context(
    name: Optional[str] = None,
    trace_id: Optional[str] = None,
    session_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    parent_run_id: Optional[str] = None,
) -> Iterator[Dict[str, Any]]:
    """Group calls into one trace and auto-link parents.

    Records created inside the block inherit the context's ``trace_id``,
    ``session_id`` and ``agent_name`` when they do not set their own. Calls in
    the same block are siblings: they all get the block's ``parent_run_id``
    (the enclosing context's latest run when the block was opened). Nested
    blocks therefore hang a subagent's calls under the call that started it,
    without turning sequential calls into one long chain.
    """
    parent = _current.get() or {}
    context: Dict[str, Any] = {
        "trace_id": trace_id or parent.get("trace_id") or uuid.uuid4().hex,
        "session_id": session_id or parent.get("session_id"),
        "agent_name": agent_name or parent.get("agent_name"),
        "parent_run_id": parent_run_id or parent.get("last_run_id"),
        "name": name or parent.get("name"),
        "last_run_id": None,
    }
    token = _current.set(context)
    try:
        yield context
    finally:
        _current.reset(token)
