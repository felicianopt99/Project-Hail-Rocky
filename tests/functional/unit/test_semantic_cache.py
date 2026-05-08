import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from app.core.semantic_cache import RockySemanticCache


def _make_cache_with_mock_inner(mock_inner):
    with patch("app.core.semantic_cache.settings") as s, \
         patch("app.core.semantic_cache.HFTextVectorizer"), \
         patch("app.core.semantic_cache.SemanticCache", return_value=mock_inner):
        s.semantic_cache_enabled = True
        s.embedding_model = "test-model"
        s.redis_url = "redis://localhost:6381"
        s.semantic_cache_threshold = 0.95
        return RockySemanticCache()


class TestDisabled:
    def test_cache_is_none_when_flag_off(self):
        with patch("app.core.semantic_cache.settings") as s:
            s.semantic_cache_enabled = False
            c = RockySemanticCache()
        assert c.cache is None

    async def test_check_returns_none_when_disabled(self):
        with patch("app.core.semantic_cache.settings") as s:
            s.semantic_cache_enabled = False
            c = RockySemanticCache()
        assert await c.check("hello") is None

    async def test_store_is_noop_when_disabled(self):
        with patch("app.core.semantic_cache.settings") as s:
            s.semantic_cache_enabled = False
            c = RockySemanticCache()
        await c.store("hello", "world")  # must not raise

    async def test_close_is_noop_when_disabled(self):
        with patch("app.core.semantic_cache.settings") as s:
            s.semantic_cache_enabled = False
            c = RockySemanticCache()
        await c.close()  # must not raise


class TestEnabled:
    async def test_check_returns_hit_with_score(self):
        mock_inner = MagicMock()
        mock_inner.check.return_value = [{"cache_entry": "Yes!", "vector_distance": 0.02}]
        c = _make_cache_with_mock_inner(mock_inner)
        result = await c.check("hello")
        assert result is not None
        assert result["response"] == "Yes!"
        assert result["score"] == pytest.approx(0.98)

    async def test_check_returns_none_on_empty_results(self):
        mock_inner = MagicMock()
        mock_inner.check.return_value = []
        c = _make_cache_with_mock_inner(mock_inner)
        assert await c.check("hello") is None

    async def test_check_returns_none_on_exception(self):
        mock_inner = MagicMock()
        mock_inner.check.side_effect = Exception("redis error")
        c = _make_cache_with_mock_inner(mock_inner)
        assert await c.check("hello") is None

    async def test_store_calls_inner_cache(self):
        mock_inner = MagicMock()
        c = _make_cache_with_mock_inner(mock_inner)
        await c.store("hello", "world", {"key": "val"})
        mock_inner.store.assert_called_once_with(
            prompt="hello", response="world", metadata={"key": "val"}
        )

    async def test_store_uses_empty_metadata_by_default(self):
        mock_inner = MagicMock()
        c = _make_cache_with_mock_inner(mock_inner)
        await c.store("hi", "there")
        call_kwargs = mock_inner.store.call_args[1]
        assert call_kwargs["metadata"] == {}

    async def test_store_noop_on_exception(self):
        mock_inner = MagicMock()
        mock_inner.store.side_effect = Exception("write error")
        c = _make_cache_with_mock_inner(mock_inner)
        await c.store("hello", "world")  # must not raise

    def test_init_failure_sets_cache_to_none(self):
        with patch("app.core.semantic_cache.settings") as s, \
             patch("app.core.semantic_cache.HFTextVectorizer", side_effect=Exception("model not found")):
            s.semantic_cache_enabled = True
            s.embedding_model = "bad"
            s.redis_url = "redis://localhost"
            s.semantic_cache_threshold = 0.95
            c = RockySemanticCache()
        assert c.cache is None

    async def test_close_calls_aclose_on_async_redis(self):
        mock_redis = AsyncMock()
        mock_inner = MagicMock()
        mock_inner.redis = mock_redis
        c = _make_cache_with_mock_inner(mock_inner)
        await c.close()
        mock_redis.aclose.assert_called_once()
