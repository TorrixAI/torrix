"""Automatic capture of OpenAI and Anthropic SDK calls into Torrix.

``wrap("openai")`` and ``wrap("anthropic")`` patch the sync and async resource
classes so ``chat.completions.create`` / ``messages.create`` calls are recorded
and forwarded to the configured Torrix instance. Streaming responses are
accumulated as the caller iterates them, then recorded once at end of stream
with the reconstructed response text, tool calls and usage.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

_TRANSPORT_KEYS = {"timeout", "max_retries", "extra_headers", "extra_query", "extra_body", "api_key", "base_url"}

_PATCHED: Dict[int, List[Tuple[Any, Any, str]]] = {}
_CLASS_PATCHES: Dict[str, int] = {}


def patch_classes(provider: str = "openai") -> int:
    """Patch the SDK resource classes once per provider; returns the handle.

    Safe to call repeatedly: a second call returns the existing handle instead
    of stacking another wrapper. Missing SDKs raise ImportError, which callers
    like ``init`` swallow so an uninstalled library cannot crash startup.
    """
    if provider in _CLASS_PATCHES:
        return _CLASS_PATCHES[provider]
    if provider == "openai":
        import openai.resources.chat.completions as chat
        import openai.resources.completions as base

        targets = [
            (chat.Completions, "create"),
            (chat.AsyncCompletions, "create"),
            (base.Completions, "create"),
            (base.AsyncCompletions, "create"),
        ]
    elif provider == "anthropic":
        import anthropic.resources.messages as messages

        targets = [
            (messages.Messages, "create"),
            (messages.AsyncMessages, "create"),
        ]
    else:
        raise ValueError(f"unsupported provider '{provider}' (expected 'openai' or 'anthropic')")

    handle = uuid.uuid4().int
    patches = []
    for cls, name in targets:
        original = getattr(cls, name)
        setattr(cls, name, _chain(original, provider))
        patches.append((original, cls, name))
    _PATCHED[handle] = patches
    _CLASS_PATCHES[provider] = handle
    return handle


def wrap(target: Any = None, provider: Optional[str] = None) -> Any:
    """Wrap the OpenAI or Anthropic SDK calls into Torrix.

    Two call styles are supported, matching the original SDK:

    ``torrix.wrap()`` / ``torrix.wrap("anthropic")``
        Patch the SDK's resource classes globally (sync and async), including
        streaming responses. Returns a numeric handle for ``unwrap``.

    ``torrix.wrap(client)``
        Return a lightweight proxy around one client instance. Use the proxy
        in place of the raw client; the original object is untouched.
    """
    if target is None or isinstance(target, str):
        if isinstance(target, str) and provider is None:
            provider = target
        return patch_classes(provider or "openai")
    resolved = provider or _detect_provider(target)
    return _instrument_client(target, resolved)


def _detect_provider(client: Any) -> str:
    module = type(client).__module__.lower()
    name = type(client).__name__.lower()
    return "anthropic" if "anthropic" in module or "anthropic" in name else "openai"


class _OpenAICompletionsProxy:
    def __init__(self, resource: Any) -> None:
        self._resource = resource

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resource, name)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return _create_wrapper(self._resource, self._resource.create, "openai", *args, **kwargs)


class _OpenAIChatProxy:
    def __init__(self, chat: Any) -> None:
        self._chat = chat

    def __getattr__(self, name: str) -> Any:
        return getattr(self._chat, name)

    @property
    def completions(self) -> _OpenAICompletionsProxy:
        return _OpenAICompletionsProxy(self._chat.completions)


class _AnthropicMessagesProxy:
    def __init__(self, resource: Any) -> None:
        self._resource = resource

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resource, name)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return _create_wrapper(self._resource, self._resource.create, "anthropic", *args, **kwargs)


class _OpenAIClientProxy:
    def __init__(self, client: Any) -> None:
        self._client = client

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    @property
    def chat(self) -> _OpenAIChatProxy:
        return _OpenAIChatProxy(self._client.chat)

    @property
    def completions(self) -> _OpenAICompletionsProxy:
        return _OpenAICompletionsProxy(self._client.completions)


class _AnthropicClientProxy:
    def __init__(self, client: Any) -> None:
        self._client = client

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    @property
    def messages(self) -> _AnthropicMessagesProxy:
        return _AnthropicMessagesProxy(self._client.messages)


def _instrument_client(client: Any, provider: str) -> Any:
    if provider == "anthropic":
        return _AnthropicClientProxy(client)
    return _OpenAIClientProxy(client)


def unwrap(handle: Optional[int] = None) -> None:
    """Restore the original SDK methods for a wrapped handle (or all)."""
    handles = list(_PATCHED.keys()) if handle is None else [handle]
    for key in handles:
        for original, cls, name in _PATCHED.pop(key, []):
            if getattr(cls, name, None) is not None:
                setattr(cls, name, original)
    for provider, value in list(_CLASS_PATCHES.items()):
        if value not in _PATCHED:
            _CLASS_PATCHES.pop(provider, None)


def _chain(original: Callable[..., Any], provider: str) -> Callable[..., Any]:
    def wrapped(self: Any, *args: Any, **kwargs: Any) -> Any:
        return _create_wrapper(self, original, provider, *args, **kwargs)

    return wrapped


def _create_wrapper(self: Any, original: Callable[..., Any], provider: str, *args: Any, **kwargs: Any) -> Any:
    from . import current

    client = current()
    if client is None or not client.enabled:
        return original(self, *args, **kwargs)

    name = kwargs.pop("torrix_name", None)
    request_body = _request_payload(kwargs)
    start = time.monotonic()
    try:
        result = original(self, *args, **kwargs)
    except Exception as exc:
        _record(
            client,
            provider,
            request_body,
            name=name,
            error=str(exc),
            error_detail=repr(exc),
            latency_ms=_since(start),
            status=_status_for(exc),
        )
        raise

    if _is_stream(result, kwargs):
        return _wrap_stream(result, client, provider, request_body, start, name)

    _record(client, provider, request_body, name=name, response=_response_dict(result), latency_ms=_since(start))
    return result


def _is_stream(result: Any, kwargs: Dict[str, Any]) -> bool:
    if kwargs.get("stream") is True:
        return True
    name = type(result).__name__.lower()
    return "stream" in name


def _request_payload(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    for key, value in kwargs.items():
        if key in _TRANSPORT_KEYS:
            continue
        payload[key] = _to_jsonable(value)
    return payload


def _record(
    client: Any,
    provider: str,
    request_body: Dict[str, Any],
    *,
    name: Optional[str] = None,
    response: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    error_detail: Optional[str] = None,
    latency_ms: Optional[int] = None,
    status: Optional[int] = None,
) -> None:
    now = datetime.now(timezone.utc)
    record: Dict[str, Any] = {
        "id": uuid.uuid4().hex,
        "model": request_body.get("model") or None,
        "request": {"body": request_body},
        "provider": provider,
    }
    if name:
        record["name"] = str(name)
    if latency_ms is not None:
        record["latency_ms"] = latency_ms
        record["start_time"] = datetime.fromtimestamp(now.timestamp() - latency_ms / 1000, tz=timezone.utc).isoformat(timespec="milliseconds")
        record["end_time"] = now.isoformat(timespec="milliseconds")
    if response is not None:
        record["response"] = {"body": response}
        record.update(_token_counts(provider, response))
        record.setdefault("status", 200)
    else:
        record["status"] = status if status is not None else (502 if error else 200)
    if error:
        record["error"] = error
        if error_detail:
            record["error_detail"] = error_detail
    try:
        client.ingest(record)
    except Exception:
        pass


def _token_counts(provider: str, response: Dict[str, Any]) -> Dict[str, int]:
    usage = response.get("usage") or {}
    if not isinstance(usage, dict):
        return {}
    counts: Dict[str, int] = {}
    if provider == "anthropic":
        if isinstance(usage.get("input_tokens"), int):
            counts["input_tokens"] = usage["input_tokens"]
        if isinstance(usage.get("output_tokens"), int):
            counts["output_tokens"] = usage["output_tokens"]
        if isinstance(usage.get("cache_read_input_tokens"), int):
            counts["cache_read_tokens"] = usage["cache_read_input_tokens"]
        if isinstance(usage.get("cache_creation_input_tokens"), int):
            counts["cache_creation_tokens"] = usage["cache_creation_input_tokens"]
        return counts
    if isinstance(usage.get("prompt_tokens"), int):
        counts["input_tokens"] = usage["prompt_tokens"]
    if isinstance(usage.get("completion_tokens"), int):
        counts["output_tokens"] = usage["completion_tokens"]
    details = usage.get("prompt_tokens_details")
    if isinstance(details, dict) and isinstance(details.get("cached_tokens"), int):
        counts["cache_read_tokens"] = details["cached_tokens"]
    return counts


def _status_for(exc: Exception) -> Optional[int]:
    status = getattr(exc, "status_code", None)
    return status if isinstance(status, int) else None


def _since(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


def _response_dict(obj: Any) -> Dict[str, Any]:
    return _serialize(obj)


def _serialize(obj: Any) -> Dict[str, Any]:
    dump = getattr(obj, "model_dump", None)
    if callable(dump):
        try:
            return _to_jsonable(dump())  # type: ignore[call-arg]
        except Exception:
            pass
    dump_json = getattr(obj, "model_dump_json", None)
    if callable(dump_json):
        try:
            return json.loads(str(dump_json()))
        except Exception:
            pass
    return _to_jsonable(vars(obj) if hasattr(obj, "__dict__") else obj)


def _to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return _to_jsonable(dump())  # type: ignore[call-arg]
        except Exception:
            pass
    return str(value)


class _SyncStreamProxy:
    """Wraps a sync stream, delegating attributes and accumulating chunks."""

    def __init__(
        self,
        stream: Any,
        accumulate: Callable[[Any], None],
        finish: Callable[[Optional[Exception]], None],
    ) -> None:
        self._stream = stream
        self._accumulate = accumulate
        self._finish_fn = finish
        self._finished = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)

    def __iter__(self) -> "_SyncStreamProxy":
        return self

    def __next__(self) -> Any:
        try:
            chunk = next(self._stream)
        except StopIteration:
            self._finish(None)
            raise
        except Exception as exc:
            self._finish(exc)
            raise
        self._accumulate(chunk)
        return chunk

    def close(self) -> None:
        close = getattr(self._stream, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass
        self._finish(None)

    def __enter__(self) -> "_SyncStreamProxy":
        enter = getattr(self._stream, "__enter__", None)
        if callable(enter):
            try:
                enter()
            except Exception:
                pass
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def _finish(self, error: Optional[Exception]) -> None:
        if self._finished:
            return
        self._finished = True
        self._finish_fn(error)


class _AsyncStreamProxy:
    """Wraps an async stream, delegating attributes and accumulating chunks."""

    def __init__(
        self,
        stream: Any,
        accumulate: Callable[[Any], None],
        finish: Callable[[Optional[Exception]], None],
    ) -> None:
        self._stream = stream
        self._accumulate = accumulate
        self._finish_fn = finish
        self._finished = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)

    def __aiter__(self) -> "_AsyncStreamProxy":
        return self

    async def __anext__(self) -> Any:
        try:
            chunk = await self._stream.__anext__()
        except StopAsyncIteration:
            self._finish(None)
            raise
        except Exception as exc:
            self._finish(exc)
            raise
        self._accumulate(chunk)
        return chunk

    async def aclose(self) -> None:
        close = getattr(self._stream, "aclose", None)
        if callable(close):
            try:
                await close()
            except Exception:
                pass
        self._finish(None)

    async def __aenter__(self) -> "_AsyncStreamProxy":
        enter = getattr(self._stream, "__aenter__", None)
        if callable(enter):
            try:
                await enter()
            except Exception:
                pass
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()

    def _finish(self, error: Optional[Exception]) -> None:
        if self._finished:
            return
        self._finished = True
        self._finish_fn(error)


def _wrap_stream(
    result: Any,
    client: Any,
    provider: str,
    request_body: Dict[str, Any],
    start: float,
    name: Optional[str] = None,
) -> Any:
    accumulator = _new_accumulator(provider)

    def accumulate(chunk: Any) -> None:
        _accumulate(provider, accumulator, chunk)

    def finish(error: Optional[Exception]) -> None:
        if error is not None:
            _record(
                client,
                provider,
                request_body,
                name=name,
                error=str(error),
                error_detail=repr(error),
                latency_ms=_since(start),
                status=_status_for(error),
            )
            return
        _record(
            client,
            provider,
            request_body,
            name=name,
            response=_assembled_response(provider, accumulator),
            latency_ms=_since(start),
        )

    if hasattr(result, "__anext__"):
        return _AsyncStreamProxy(result, accumulate, finish)
    return _SyncStreamProxy(result, accumulate, finish)


def _new_accumulator(provider: str) -> Dict[str, Any]:
    if provider == "anthropic":
        return {
            "model": None,
            "content": "",
            "thinking": "",
            "tool_calls": [],
            "usage": {},
            "finish_reason": None,
            "role": "assistant",
        }
    return {
        "model": None,
        "content": "",
        "thinking": "",
        "tool_calls": [],
        "usage": {},
        "finish_reason": None,
        "role": "assistant",
    }


def _accumulate(provider: str, accumulator: Dict[str, Any], chunk: Any) -> None:
    data = _serialize(chunk) if not isinstance(chunk, dict) else chunk
    if provider == "anthropic":
        _accumulate_anthropic(accumulator, data)
    else:
        _accumulate_openai(accumulator, data)


def _accumulate_openai(accumulator: Dict[str, Any], data: Dict[str, Any]) -> None:
    if isinstance(data.get("model"), str) and accumulator["model"] is None:
        accumulator["model"] = data["model"]
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        choice = choices[0] if isinstance(choices[0], dict) else {}
        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
        if isinstance(delta.get("content"), str):
            accumulator["content"] += delta["content"]
        if isinstance(delta.get("reasoning_content"), str):
            accumulator["thinking"] += delta["reasoning_content"]
        for tool_call in delta.get("tool_calls") or []:
            if not isinstance(tool_call, dict):
                continue
            index = tool_call.get("index", len(accumulator["tool_calls"]))
            while len(accumulator["tool_calls"]) <= index:
                accumulator["tool_calls"].append({"id": None, "name": "", "arguments": ""})
            entry = accumulator["tool_calls"][index]
            if tool_call.get("id"):
                entry["id"] = tool_call["id"]
            function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
            if isinstance(function.get("name"), str):
                entry["name"] += function["name"]
            if isinstance(function.get("arguments"), str):
                entry["arguments"] += function["arguments"]
        if choice.get("finish_reason"):
            accumulator["finish_reason"] = choice["finish_reason"]
    usage = data.get("usage")
    if isinstance(usage, dict):
        accumulator["usage"] = usage


def _accumulate_anthropic(accumulator: Dict[str, Any], data: Dict[str, Any]) -> None:
    if isinstance(data.get("model"), str) and accumulator["model"] is None:
        accumulator["model"] = data["model"]
    event_type = data.get("type")
    if event_type == "message_start":
        message = data.get("message") if isinstance(data.get("message"), dict) else {}
        if isinstance(message.get("model"), str):
            accumulator["model"] = message["model"]
        if isinstance(message.get("usage"), dict):
            accumulator["usage"].update(message["usage"])
    elif event_type == "content_block_start":
        block = data.get("content_block") if isinstance(data.get("content_block"), dict) else {}
        if block.get("type") == "tool_use":
            accumulator["tool_calls"].append(
                {"id": block.get("id"), "name": block.get("name") or "", "arguments": ""}
            )
    elif event_type == "content_block_delta":
        delta = data.get("delta") if isinstance(data.get("delta"), dict) else {}
        if delta.get("type") == "text_delta" and isinstance(delta.get("text"), str):
            accumulator["content"] += delta["text"]
        elif delta.get("type") == "thinking_delta" and isinstance(delta.get("thinking"), str):
            accumulator["thinking"] += delta["thinking"]
        elif delta.get("type") == "input_json_delta" and isinstance(delta.get("partial_json"), str):
            if accumulator["tool_calls"]:
                accumulator["tool_calls"][-1]["arguments"] += delta["partial_json"]
    elif event_type == "message_delta":
        delta = data.get("delta") if isinstance(data.get("delta"), dict) else {}
        if delta.get("stop_reason"):
            accumulator["finish_reason"] = delta["stop_reason"]
        if isinstance(data.get("usage"), dict):
            accumulator["usage"].update(data["usage"])


def _assembled_response(provider: str, accumulator: Dict[str, Any]) -> Dict[str, Any]:
    tool_calls = [entry for entry in accumulator["tool_calls"] if entry.get("name")]
    if provider == "anthropic":
        content: List[Dict[str, Any]] = []
        if accumulator["content"]:
            content.append({"type": "text", "text": accumulator["content"]})
        for tool in tool_calls:
            content.append(
                {
                    "type": "tool_use",
                    "id": tool.get("id") or f"toolu_{uuid.uuid4().hex[:12]}",
                    "name": tool["name"],
                    "input": _maybe_json(tool.get("arguments")),
                }
            )
        response: Dict[str, Any] = {
            "model": accumulator["model"],
            "role": "assistant",
            "content": content,
            "stop_reason": accumulator["finish_reason"],
            "usage": accumulator["usage"],
        }
        if accumulator["thinking"]:
            response["thinking"] = accumulator["thinking"]
        return response
    message: Dict[str, Any] = {"role": "assistant", "content": accumulator["content"]}
    if accumulator["thinking"]:
        message["reasoning_content"] = accumulator["thinking"]
    if tool_calls:
        message["tool_calls"] = [
            {
                "id": tool.get("id") or f"call_{uuid.uuid4().hex[:12]}",
                "type": "function",
                "function": {"name": tool["name"], "arguments": tool.get("arguments") or "{}"},
            }
            for tool in tool_calls
        ]
    return {
        "model": accumulator["model"],
        "choices": [{"index": 0, "message": message, "finish_reason": accumulator["finish_reason"]}],
        "usage": accumulator["usage"],
    }


def _maybe_json(text: Optional[str]) -> Any:
    if not text:
        return {}
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return text
