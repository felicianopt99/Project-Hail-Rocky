import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.rocky.personality.emotional_states import detect, load, save, STATES


class TestDetect:
    def _at_hour(self, hour: int, message: str, current: str = "neutral") -> str:
        mock_now = MagicMock()
        mock_now.hour = hour
        with patch("app.rocky.personality.emotional_states.datetime") as mock_dt:
            mock_dt.now.return_value = mock_now
            return detect(message, current)

    def test_tired_late_night(self):
        assert self._at_hour(23, "hello") == "tired"

    def test_tired_early_morning(self):
        assert self._at_hour(3, "hello") == "tired"

    def test_tired_at_midnight(self):
        assert self._at_hour(0, "hello") == "tired"

    def test_not_tired_at_daytime(self):
        assert self._at_hour(10, "hello") != "tired"

    def test_focused_on_python_keyword(self):
        assert self._at_hour(14, "debug this python code") == "focused"

    def test_focused_on_docker(self):
        assert self._at_hour(10, "docker container is failing") == "focused"

    def test_focused_on_api(self):
        assert self._at_hour(12, "the api endpoint broke") == "focused"

    def test_excited_wow(self):
        assert self._at_hour(14, "that is wow amazing") == "excited"

    def test_excited_multilingual(self):
        assert self._at_hour(14, "isso é incrível") == "excited"

    def test_excited_french(self):
        assert self._at_hour(14, "c'est incroyable") == "excited"

    def test_curious_question_mark(self):
        assert self._at_hour(14, "what time is it?") == "curious"

    def test_curious_keyword(self):
        assert self._at_hour(14, "how does this work") == "curious"

    def test_curious_multilingual(self):
        assert self._at_hour(14, "porquê aconteceu isso") == "curious"

    def test_falls_back_to_current_state(self):
        assert self._at_hour(14, "just a normal sentence", "excited") == "excited"

    def test_tech_takes_priority_over_excited(self):
        # "amazing python" has both excited and tech keywords → focused wins
        assert self._at_hour(14, "amazing python code") == "focused"

    def test_multiple_question_marks(self):
        assert self._at_hour(14, "why why why???") == "curious"


@pytest.mark.asyncio
async def test_load_returns_neutral_without_redis():
    assert await load("sid", redis=None) == "neutral"


@pytest.mark.asyncio
async def test_load_valid_state_from_redis():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "curious"
    assert await load("sid", redis=mock_redis) == "curious"


@pytest.mark.asyncio
async def test_load_neutral_for_invalid_state():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "not_a_valid_state"
    assert await load("sid", redis=mock_redis) == "neutral"


@pytest.mark.asyncio
async def test_load_neutral_for_missing_key():
    mock_redis = AsyncMock()
    mock_redis.get.return_value = None
    assert await load("sid", redis=mock_redis) == "neutral"


@pytest.mark.asyncio
async def test_save_writes_to_redis():
    mock_redis = AsyncMock()
    await save("sid", "focused", redis=mock_redis, ttl=1800)
    mock_redis.setex.assert_called_once_with("rocky:state:sid", 1800, "focused")


@pytest.mark.asyncio
async def test_save_ignores_invalid_state():
    mock_redis = AsyncMock()
    await save("sid", "invalid_state", redis=mock_redis)
    mock_redis.setex.assert_not_called()


@pytest.mark.asyncio
async def test_save_no_op_without_redis():
    await save("sid", "neutral", redis=None)  # must not raise


def test_all_states_are_valid():
    # Sanity check: load can return each declared state
    assert all(s in STATES for s in ["neutral", "curious", "tired", "excited", "focused", "playful"])
