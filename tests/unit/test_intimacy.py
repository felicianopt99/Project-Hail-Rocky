import pytest
from unittest.mock import AsyncMock
from app.rocky.personality.intimacy import label, behavior_hint, load, update


class TestLabel:
    def test_stranger_at_zero(self):
        assert label(0) == "stranger"

    def test_stranger_at_boundary(self):
        assert label(30) == "stranger"

    def test_acquaintance(self):
        assert label(31) == "acquaintance"
        assert label(60) == "acquaintance"

    def test_friend(self):
        assert label(61) == "friend"
        assert label(85) == "friend"

    def test_close_friend(self):
        assert label(86) == "close_friend"
        assert label(100) == "close_friend"


class TestBehaviorHint:
    def test_returns_non_empty_string_for_each_range(self):
        for score in [15.0, 45.0, 75.0, 95.0]:
            h = behavior_hint(score)
            assert isinstance(h, str) and h


@pytest.mark.asyncio
async def test_load_default_without_redis():
    assert await load("u", redis=None) == 35.0


@pytest.mark.asyncio
async def test_load_from_redis():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "72.5"
    assert await load("u", redis=mock_redis) == 72.5


@pytest.mark.asyncio
async def test_load_default_when_key_missing():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = None
    assert await load("u", redis=mock_redis) == 35.0


@pytest.mark.asyncio
async def test_update_positive_word_increases_by_one():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "50.0"
    # No punctuation — split() keeps "thanks," attached otherwise
    score = await update("u", "thanks that was great", redis=mock_redis)
    assert score == 51.0


@pytest.mark.asyncio
async def test_update_negative_word_decreases_by_half():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "50.0"
    score = await update("u", "that was wrong and bad", redis=mock_redis)
    assert score == 49.5


@pytest.mark.asyncio
async def test_update_neutral_message_increments_slightly():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "50.0"
    score = await update("u", "what time is it", redis=mock_redis)
    assert abs(score - 50.2) < 1e-9


@pytest.mark.asyncio
async def test_update_caps_at_100():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "99.5"
    score = await update("u", "thanks", redis=mock_redis)
    assert score == 100.0


@pytest.mark.asyncio
async def test_update_floors_at_0():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "0.3"
    score = await update("u", "that was wrong", redis=mock_redis)
    assert score == 0.0


@pytest.mark.asyncio
async def test_update_saves_to_redis():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "50.0"
    score = await update("u", "hello", redis=mock_redis)
    mock_redis.set.assert_called_once_with("rocky:intimacy:u", str(score))


@pytest.mark.asyncio
async def test_update_multilingual_positive():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "50.0"
    score = await update("u", "obrigado", redis=mock_redis)
    assert score == 51.0


@pytest.mark.asyncio
async def test_update_multilingual_negative():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "50.0"
    score = await update("u", "isso foi errado", redis=mock_redis)
    assert score == 49.5
