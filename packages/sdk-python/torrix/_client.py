"""Low-level ingest client for the Torrix server.

Records are queued and delivered by a background daemon thread, so logging
never blocks a request path. The queue is flushed on interpreter shutdown
(``atexit``) and can be flushed manually with :meth:`TorrixClient.flush`.
"""

from __future__ import annotations

import atexit
import json
import queue
import random
import uuid
import threading
import time
from typing import Any, Dict, List, Optional, Union
from urllib import request

from ._context import current_context


class TorrixError(RuntimeError):
    """Raised when the Torrix server rejects a payload or cannot be reached."""


_BATCH_SIZE = 500
_FLUSH_TIMEOUT_SECONDS = 5.0


class TorrixClient:
    """Posts run records to a Torrix instance over HTTP."""

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        *,
        project: Optional[str] = None,
        sample_rate: float = 1.0,
        timeout: float = 10.0,
        enabled: bool = True,
        background: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.project = project
        self.sample_rate = _clamp01(sample_rate)
        self.timeout = timeout
        self.enabled = enabled
        self.background = background
        self._accepted = 0
        self._dropped = 0
        self._last_error: Optional[str] = None
        self._queue: "queue.Queue[List[Dict[str, Any]] | None]" = queue.Queue()
        self._worker: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._closed = False
        if background:
            self._worker = threading.Thread(target=self._worker_loop, name="torrix-ingest", daemon=True)
            self._worker.start()
            atexit.register(self.close)

    def ingest(
        self,
        records: Union[Dict[str, Any], List[Dict[str, Any]]],
        *,
        wait: bool = False,
    ) -> List[str]:
        """Send one run record (or a batch) and return the accepted run ids.

        With the default background mode the call returns immediately (an empty
        list) after queueing; pass ``wait=True`` to deliver synchronously and
        receive the ids. Each record accepts the fields documented for
        ``POST /api/ingest``: ``request`` / ``response`` (each ``{"body": ...}``),
        ``model``, ``provider``, ``status``, ``error``, ``latency_ms``,
        ``start_time`` / ``end_time``, ``input_tokens``, ``output_tokens``,
        ``cost_usd``, ``target_url``, ``trace_id``, ``session_id``, ``tags``.
        """
        if not self.enabled or self._closed:
            return []
        items = [records] if isinstance(records, dict) else list(records)
        if not items:
            return []
        context = current_context()
        if context:
            for record in items:
                if not isinstance(record, dict):
                    continue
                record.setdefault("trace_id", context.get("trace_id"))
                if context.get("session_id"):
                    record.setdefault("session_id", context["session_id"])
                if context.get("agent_name"):
                    record.setdefault("agent_name", context["agent_name"])
                # Calls inside one context are siblings under the context's parent;
                # only a nested context hangs under the latest call of its enclosing one.
                if context.get("parent_run_id"):
                    record.setdefault("parent_run_id", context["parent_run_id"])
                if context.get("name") and not record.get("name"):
                    record["name"] = context["name"]
                record.setdefault("id", uuid.uuid4().hex)
                context["last_run_id"] = record["id"]

        accepted: List[str] = []
        for start in range(0, len(items), _BATCH_SIZE):
            batch = [r for r in items[start : start + _BATCH_SIZE] if random.random() < self.sample_rate]
            if not batch:
                continue
            if self.background and not wait:
                self._queue.put(batch)
            else:
                accepted.extend(self._send(batch, timeout=self.timeout))
        self._accepted += len(accepted)
        self._dropped += len(items) - len(accepted)
        return accepted

    def flush(self, timeout: float = _FLUSH_TIMEOUT_SECONDS) -> bool:
        """Block until the queue drains or ``timeout`` elapses."""
        if not self.background:
            return True
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._queue.unfinished_tasks == 0:
                return True
            time.sleep(0.01)
        return self._queue.unfinished_tasks == 0

    def close(self) -> None:
        """Flush pending records and stop the worker thread."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
        if self.background:
            self.flush()
            self._queue.put(None)
            if self._worker is not None:
                self._worker.join(timeout=1.0)

    def stats(self) -> Dict[str, Any]:
        return {
            "accepted": self._accepted,
            "dropped": self._dropped,
            "queued": self._queue.qsize(),
            "last_error": self._last_error,
        }

    def _worker_loop(self) -> None:
        while True:
            batch = self._queue.get()
            try:
                if batch is None:
                    return
                self._send(batch, timeout=min(self.timeout, _FLUSH_TIMEOUT_SECONDS))
            except TorrixError as exc:
                self._last_error = str(exc)
            except Exception as exc:  # pragma: no cover - defensive
                self._last_error = str(exc)
            finally:
                self._queue.task_done()

    def _send(self, batch: List[Dict[str, Any]], *, timeout: float) -> List[str]:
        url = f"{self.base_url}/api/ingest"
        payload = json.dumps({"records": batch}).encode("utf-8")
        headers = {"content-type": "application/json", "user-agent": "torrix-sdk/1.1.0"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        if self.project:
            headers["x-torrix-project"] = self.project
        req = request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8")
                if resp.status >= 400:
                    raise TorrixError(f"ingest rejected with HTTP {resp.status}: {body}")
                parsed = json.loads(body) if body else {}
                return list(parsed.get("ids", []))
        except TorrixError:
            self._last_error = "torrix_rejected"
            raise
        except Exception as exc:  # network, DNS, timeout
            self._last_error = str(exc)
            raise TorrixError(f"torrix unreachable: {exc}") from exc

    def health(self) -> bool:
        try:
            with request.urlopen(f"{self.base_url}/health", timeout=self.timeout) as resp:
                return resp.status == 200
        except Exception:
            return False


def _clamp01(value: float) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return 1.0
