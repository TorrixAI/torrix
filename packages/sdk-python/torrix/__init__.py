"""torrix — self-hosted LLM observability SDK.

Intercept and log every model call your application makes to a Torrix
instance. Two usage styles are supported:

``torrix.init(...)`` then ``torrix.wrap()``
    Apply a global patch to the OpenAI or Anthropic SDK so
    ``chat.completions.create`` / ``messages.create`` are captured
    automatically (sync and async, streaming included).

``torrix.ingest(record)``
    Log arbitrary run records manually — useful for providers without a
    ready-made wrapper or for custom tooling. Records are delivered by a
    background thread and flushed on process exit.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from ._client import TorrixClient, TorrixError
from ._context import current_context, run_context
from ._wrap import patch_classes as _patch_classes
from ._wrap import wrap as _wrap_sdk
from ._wrap import unwrap as _unpatch

__all__ = [
    "init",
    "wrap",
    "unwrap",
    "ingest",
    "flush",
    "current",
    "get_client",
    "run_context",
    "current_run_context",
    "TorrixClient",
    "TorrixError",
]
__version__ = "1.1.1"

_DEFAULT: Optional[TorrixClient] = None


def init(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    *,
    project: Optional[str] = None,
    sample_rate: float = 1.0,
    timeout: float = 10.0,
    enabled: bool = True,
    background: bool = True,
    auto_instrument: bool = True,
) -> TorrixClient:
    """Configure the default Torrix client used by ``wrap`` and ``ingest``.

    ``api_key`` is one of your Torrix API keys (``trxk_...``) and ``base_url``
    points at the running Torrix server (default ``http://localhost:8088``).
    The older ``init(base_url, api_key)`` order is detected and accepted.
    ``project`` selects the project by id or name; when omitted the account's
    default project is used. ``sample_rate`` in ``(0, 1]`` controls what
    fraction of calls are recorded.

    Unless ``auto_instrument=False``, init patches the OpenAI and Anthropic SDK
    resource classes (whichever are installed) so calls are traced without an
    explicit ``wrap()``; ``wrap()`` then becomes a no-op returning the existing
    handle.
    """
    global _DEFAULT
    api_key, base_url = _normalize_endpoint(api_key, base_url)
    _DEFAULT = TorrixClient(
        base_url,
        api_key,
        project=project,
        sample_rate=sample_rate,
        timeout=timeout,
        enabled=enabled,
        background=background,
    )
    if auto_instrument:
        for provider in ("openai", "anthropic"):
            try:
                _patch_classes(provider)
            except Exception:
                # the SDK is optional; a missing library is not an error
                pass
    return _DEFAULT


def _normalize_endpoint(
    api_key: Optional[str],
    base_url: Optional[str],
) -> tuple[Optional[str], str]:
    default = "http://localhost:8088"
    looks_like_url = isinstance(api_key, str) and api_key.startswith(("http://", "https://"))
    if looks_like_url and (base_url is None or not base_url.startswith(("http://", "https://"))):
        # Legacy init(base_url, api_key) order.
        return base_url or None, api_key.rstrip("/")
    return api_key, (base_url or default).rstrip("/")


def current() -> Optional[TorrixClient]:
    """Return the default client configured by ``init`` (or ``None``)."""
    return _DEFAULT


def get_client() -> Optional[TorrixClient]:
    """Alias for :func:`current`."""
    return _DEFAULT


def current_run_context() -> Optional[Dict[str, Any]]:
    """Return the active run context fields, or ``None`` outside a context."""
    return current_context()


def wrap(target: Any = None, provider: Optional[str] = None) -> Any:
    """Patch the OpenAI or Anthropic SDK to auto-log calls into Torrix.

    ``wrap()`` / ``wrap("anthropic")`` patch the SDK resource classes globally
    (sync, async and streaming). ``wrap(client)`` returns a tracing proxy for a
    single client instance instead. The handle returned by the class-level form
    can be passed to ``unwrap``; proxies are dropped by using the raw client
    again.
    """
    return _wrap_sdk(target, provider)


def unwrap(handle: Optional[int] = None) -> None:
    """Restore the original SDK methods for a wrapped ``handle`` (or all)."""
    _unpatch(handle)


def ingest(records: Union[Dict[str, Any], List[Dict[str, Any]]], *, wait: bool = False) -> List[str]:
    """Log one or several run records through the default client.

    Background delivery is the default; pass ``wait=True`` to block until the
    records are accepted and receive their ids. Raises :class:`TorrixError` if
    no client has been configured with :func:`init`.
    """
    if _DEFAULT is None:
        raise TorrixError("torrix not initialized: call torrix.init() first")
    return _DEFAULT.ingest(records, wait=wait)


def flush(timeout: float = 5.0) -> bool:
    """Wait for queued records to be delivered (5 second default)."""
    if _DEFAULT is None:
        return True
    return _DEFAULT.flush(timeout)


def health() -> bool:
    if _DEFAULT is None:
        return False
    return _DEFAULT.health()
