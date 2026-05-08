import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
from app.bridges.pipecat_bridge import PipecatBridge


@pytest.fixture(autouse=True)
def reset_singleton():
    PipecatBridge._instance = None
    yield
    PipecatBridge._instance = None


def _make_bridge(sio=None):
    b = PipecatBridge(sio_server=sio or AsyncMock())
    return b


class TestSingleton:
    def test_is_singleton(self):
        b1 = _make_bridge()
        b2 = PipecatBridge()
        assert b1 is b2

    def test_initialized_once(self):
        b = _make_bridge()
        assert b._initialized is True
        assert isinstance(b._sessions, dict)


class TestIsSessionRunning:
    def test_false_when_session_does_not_exist(self):
        b = _make_bridge()
        assert b.is_session_running("nonexistent") is False

    def test_true_when_session_is_running(self):
        b = _make_bridge()
        b._sessions["s1"] = {"running": True, "starting": False}
        assert b.is_session_running("s1") is True

    def test_true_when_session_is_starting(self):
        b = _make_bridge()
        b._sessions["s1"] = {"running": False, "starting": True}
        assert b.is_session_running("s1") is True

    def test_false_when_neither_running_nor_starting(self):
        b = _make_bridge()
        b._sessions["s1"] = {"running": False, "starting": False}
        assert b.is_session_running("s1") is False


class TestGetConnection:
    async def test_creates_new_session_with_defaults(self):
        b = _make_bridge()
        with patch("app.bridges.pipecat_bridge.get_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.bridges.pipecat_bridge.get_trace_id", return_value="trace-1"), \
             patch("app.bridges.pipecat_bridge.set_trace_id", return_value="trace-1"):
            session = await b._get_connection("new-sid")

        assert session["ws"] is None
        assert session["running"] is False
        assert session["starting"] is False
        assert isinstance(session["queue"], asyncio.Queue)

    async def test_returns_existing_session(self):
        b = _make_bridge()
        existing = {
            "ws": None, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0, "task": None,
        }
        b._sessions["existing-sid"] = existing
        session = await b._get_connection("existing-sid")
        assert session is existing


class TestStop:
    async def test_stop_marks_session_not_running(self):
        b = _make_bridge()
        b._sessions["sid-stop"] = {
            "ws": None, "task": None, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0,
        }
        with patch("app.bridges.pipecat_bridge.get_redis", new_callable=AsyncMock, return_value=None):
            await b.stop("sid-stop")
        assert b._sessions["sid-stop"]["running"] is False

    async def test_stop_closes_websocket(self):
        b = _make_bridge()
        mock_ws = AsyncMock()
        b._sessions["sid-ws"] = {
            "ws": mock_ws, "task": None, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0,
        }
        with patch("app.bridges.pipecat_bridge.get_redis", new_callable=AsyncMock, return_value=None):
            await b.stop("sid-ws")
        mock_ws.close.assert_called_once()
        assert b._sessions["sid-ws"]["ws"] is None

    async def test_stop_cancels_listen_task(self):
        b = _make_bridge()
        mock_task = MagicMock()
        mock_task.cancel = MagicMock()
        b._sessions["sid-task"] = {
            "ws": None, "task": mock_task, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0,
        }
        with patch("app.bridges.pipecat_bridge.get_redis", new_callable=AsyncMock, return_value=None):
            await b.stop("sid-task")
        mock_task.cancel.assert_called_once()

    async def test_stop_noop_for_unknown_sid(self):
        b = _make_bridge()
        # Must not raise
        await b.stop("unknown-sid")


class TestSendCancelFrame:
    async def test_sends_cancel_json_when_running(self):
        b = _make_bridge()
        mock_ws = AsyncMock()
        b._sessions["sid-cancel"] = {
            "ws": mock_ws, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0, "task": None,
        }
        await b.send_cancel_frame("sid-cancel")
        mock_ws.send.assert_called_once()
        payload = json.loads(mock_ws.send.call_args[0][0])
        assert payload["type"] == "cancel"

    async def test_no_send_when_not_running(self):
        b = _make_bridge()
        mock_ws = AsyncMock()
        b._sessions["sid-idle"] = {
            "ws": mock_ws, "running": False, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0, "task": None,
        }
        await b.send_cancel_frame("sid-idle")
        mock_ws.send.assert_not_called()

    async def test_no_send_when_no_websocket(self):
        b = _make_bridge()
        b._sessions["sid-no-ws"] = {
            "ws": None, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0, "task": None,
        }
        await b.send_cancel_frame("sid-no-ws")  # must not raise


class TestSendEot:
    async def test_sends_end_of_turn(self):
        b = _make_bridge()
        mock_ws = AsyncMock()
        b._sessions["sid-eot"] = {
            "ws": mock_ws, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0, "task": None,
        }
        await b.send_eot("sid-eot")
        payload = json.loads(mock_ws.send.call_args[0][0])
        assert payload["type"] == "end_of_turn"


class TestInterruptSpeech:
    async def test_alias_for_send_cancel_frame(self):
        b = _make_bridge()
        with patch.object(b, "send_cancel_frame", new_callable=AsyncMock) as mock_cancel:
            await b.interrupt_speech("sid-x")
        mock_cancel.assert_called_once_with("sid-x")


class TestStopAll:
    async def test_stops_all_sessions(self):
        b = _make_bridge()
        b._sessions["s1"] = {
            "ws": None, "task": None, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0,
        }
        b._sessions["s2"] = {
            "ws": None, "task": None, "running": True, "starting": False,
            "queue": asyncio.Queue(), "trace_id": "t", "retry_count": 0,
        }
        with patch("app.bridges.pipecat_bridge.get_redis", new_callable=AsyncMock, return_value=None):
            await b.stop_all()
        assert b._sessions["s1"]["running"] is False
        assert b._sessions["s2"]["running"] is False
