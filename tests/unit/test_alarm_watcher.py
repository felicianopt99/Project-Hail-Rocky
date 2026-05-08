import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch


class TestAlarmWatcherDispatch:
    async def test_dispatches_alarm_fired_event(self):
        from app.core.alarm_watcher import _watch

        alarm = json.dumps({"type": "alarm", "label": "wake-up", "message": None})
        mock_redis = AsyncMock()
        mock_redis.zrangebyscore = AsyncMock(return_value=[(alarm, 1000.0)])
        mock_redis.zrem = AsyncMock()
        mock_sio = AsyncMock()

        async def fake_sleep(_):
            raise asyncio.CancelledError()

        with patch("app.core.alarm_watcher.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.core.alarm_watcher.asyncio.sleep", side_effect=fake_sleep), \
             patch("app.core.alarm_watcher.time.time", return_value=1000.0):
            try:
                await _watch(mock_sio)
            except asyncio.CancelledError:
                pass

        mock_sio.emit.assert_called_once_with(
            "alarm_fired",
            {"label": "wake-up", "message": None, "type": "alarm"},
        )

    async def test_dispatches_reminder_fired_event(self):
        from app.core.alarm_watcher import _watch

        reminder = json.dumps({"type": "reminder", "label": "meds", "message": "Take pills"})
        mock_redis = AsyncMock()
        mock_redis.zrangebyscore = AsyncMock(return_value=[(reminder, 1000.0)])
        mock_redis.zrem = AsyncMock()
        mock_sio = AsyncMock()

        async def fake_sleep(_):
            raise asyncio.CancelledError()

        with patch("app.core.alarm_watcher.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.core.alarm_watcher.asyncio.sleep", side_effect=fake_sleep), \
             patch("app.core.alarm_watcher.time.time", return_value=1000.0):
            try:
                await _watch(mock_sio)
            except asyncio.CancelledError:
                pass

        mock_sio.emit.assert_called_once_with(
            "reminder_fired",
            {"label": "meds", "message": "Take pills", "type": "reminder"},
        )

    async def test_removes_alarm_from_redis_after_dispatch(self):
        from app.core.alarm_watcher import _watch

        alarm_raw = json.dumps({"type": "alarm", "label": "test"})
        mock_redis = AsyncMock()
        mock_redis.zrangebyscore = AsyncMock(return_value=[(alarm_raw, 1000.0)])
        mock_redis.zrem = AsyncMock()
        mock_sio = AsyncMock()

        async def fake_sleep(_):
            raise asyncio.CancelledError()

        with patch("app.core.alarm_watcher.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.core.alarm_watcher.asyncio.sleep", side_effect=fake_sleep), \
             patch("app.core.alarm_watcher.time.time", return_value=1000.0):
            try:
                await _watch(mock_sio)
            except asyncio.CancelledError:
                pass

        mock_redis.zrem.assert_called_once_with("rocky:alarms", alarm_raw)

    async def test_skips_and_removes_invalid_json(self):
        from app.core.alarm_watcher import _watch

        mock_redis = AsyncMock()
        mock_redis.zrangebyscore = AsyncMock(return_value=[("not-valid-json", 1000.0)])
        mock_redis.zrem = AsyncMock()
        mock_sio = AsyncMock()

        async def fake_sleep(_):
            raise asyncio.CancelledError()

        with patch("app.core.alarm_watcher.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.core.alarm_watcher.asyncio.sleep", side_effect=fake_sleep), \
             patch("app.core.alarm_watcher.time.time", return_value=1000.0):
            try:
                await _watch(mock_sio)
            except asyncio.CancelledError:
                pass

        mock_redis.zrem.assert_called_once_with("rocky:alarms", "not-valid-json")
        mock_sio.emit.assert_not_called()

    async def test_no_emit_when_no_due_alarms(self):
        from app.core.alarm_watcher import _watch

        mock_redis = AsyncMock()
        mock_redis.zrangebyscore = AsyncMock(return_value=[])
        mock_sio = AsyncMock()

        async def fake_sleep(_):
            raise asyncio.CancelledError()

        with patch("app.core.alarm_watcher.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.core.alarm_watcher.asyncio.sleep", side_effect=fake_sleep), \
             patch("app.core.alarm_watcher.time.time", return_value=1000.0):
            try:
                await _watch(mock_sio)
            except asyncio.CancelledError:
                pass

        mock_sio.emit.assert_not_called()

    async def test_noop_when_redis_unavailable(self):
        from app.core.alarm_watcher import _watch

        mock_sio = AsyncMock()

        async def fake_sleep(_):
            raise asyncio.CancelledError()

        with patch("app.core.alarm_watcher.get_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.core.alarm_watcher.asyncio.sleep", side_effect=fake_sleep):
            try:
                await _watch(mock_sio)
            except asyncio.CancelledError:
                pass

        mock_sio.emit.assert_not_called()

    async def test_continues_after_redis_exception(self):
        from app.core.alarm_watcher import _watch

        mock_redis = AsyncMock()
        mock_redis.zrangebyscore = AsyncMock(side_effect=Exception("redis error"))
        mock_sio = AsyncMock()

        call_count = 0

        async def fake_sleep(_):
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                raise asyncio.CancelledError()

        with patch("app.core.alarm_watcher.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.core.alarm_watcher.asyncio.sleep", side_effect=fake_sleep), \
             patch("app.core.alarm_watcher.time.time", return_value=1000.0):
            try:
                await _watch(mock_sio)
            except asyncio.CancelledError:
                pass

        assert call_count == 2  # looped again after exception


class TestAlarmWatcherStart:
    def test_start_returns_task(self):
        from app.core.alarm_watcher import start

        mock_sio = MagicMock()
        mock_task = MagicMock()

        with patch("app.core.alarm_watcher.asyncio.create_task", return_value=mock_task) as mock_create:
            task = start(mock_sio)

        assert task is mock_task
        mock_create.assert_called_once()
