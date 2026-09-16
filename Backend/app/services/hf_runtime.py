from __future__ import annotations

import threading

HF_MODEL_LOAD_LOCK = threading.Lock()
_PIPELINE_CACHE_LOCK = threading.Lock()
_PIPELINE_CACHE: dict[tuple[str, str, int], object] = {}

_META_TENSOR_ERROR_MARKERS = (
    "meta tensor",
    "called on meta tensors",
    "cannot copy out of meta tensor",
    "cannot copy out of meta tensors",
    "expected device meta",
    "not on the expected device meta",
    "is on the meta device",
)


def is_meta_tensor_error(exc: Exception | str | None) -> bool:
    text = str(exc or "").strip().lower()
    if not text:
        return False
    return any(marker in text for marker in _META_TENSOR_ERROR_MARKERS)


def get_cached_pipeline(task: str, model_name: str, device_id: int) -> object | None:
    cache_key = (str(task).strip(), str(model_name).strip(), int(device_id))
    with _PIPELINE_CACHE_LOCK:
        return _PIPELINE_CACHE.get(cache_key)


def get_or_create_cached_pipeline(
    task: str,
    model_name: str,
    device_id: int,
    loader,
):
    cache_key = (str(task).strip(), str(model_name).strip(), int(device_id))
    with _PIPELINE_CACHE_LOCK:
        cached = _PIPELINE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    with HF_MODEL_LOAD_LOCK:
        with _PIPELINE_CACHE_LOCK:
            cached = _PIPELINE_CACHE.get(cache_key)
        if cached is not None:
            return cached
        loaded_pipeline = loader()
        with _PIPELINE_CACHE_LOCK:
            cached = _PIPELINE_CACHE.get(cache_key)
            if cached is not None:
                return cached
            _PIPELINE_CACHE[cache_key] = loaded_pipeline
            return loaded_pipeline


def discard_cached_pipeline(task: str, model_name: str, device_id: int) -> None:
    cache_key = (str(task).strip(), str(model_name).strip(), int(device_id))
    with _PIPELINE_CACHE_LOCK:
        _PIPELINE_CACHE.pop(cache_key, None)
