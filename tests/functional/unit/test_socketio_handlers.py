import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.api.socketio_handlers import _pop_sentence, _session, _sessions


@pytest.fixture(autouse=True)
def clear_sessions():
    _sessions.clear()
    yield
    _sessions.clear()


class TestPopSentence:
    def test_splits_on_period(self):
        sentence, rest = _pop_sentence("Hello world. And more text")
        assert sentence == "Hello world."
        assert rest == "And more text"

    def test_splits_on_question_mark(self):
        sentence, rest = _pop_sentence("Is Rocky here? Yes indeed")
        assert sentence == "Is Rocky here?"
        assert rest == "Yes indeed"

    def test_splits_on_exclamation(self):
        sentence, rest = _pop_sentence("Amaze! Very amaze.")
        assert sentence == "Amaze!"
        assert rest == "Very amaze."

    def test_no_split_when_no_sentence_boundary(self):
        sentence, rest = _pop_sentence("No boundary here")
        assert sentence == ""
        assert rest == "No boundary here"

    def test_first_chunk_allows_two_word_minimum(self):
        sentence, rest = _pop_sentence("Two words", is_first=True)
        assert sentence == "Two words"
        assert rest == ""

    def test_first_chunk_single_word_not_yielded(self):
        sentence, rest = _pop_sentence("word", is_first=True)
        assert sentence == ""
        assert rest == "word"

    def test_empty_string_returns_empty_both(self):
        sentence, rest = _pop_sentence("")
        assert sentence == ""
        assert rest == ""

    def test_ellipsis_as_sentence_end(self):
        sentence, rest = _pop_sentence("Hmm… Rocky thinks. Yes.")
        assert "Hmm…" in sentence or sentence == "Hmm…"

    def test_multiple_sentences_returns_only_first(self):
        sentence, rest = _pop_sentence("First. Second. Third.")
        assert sentence == "First."
        assert "Second" in rest


class TestSession:
    def test_creates_default_session(self):
        sess = _session("sid-1")
        assert sess["history"] == []
        assert sess["state"] == "neutral"
        assert sess["is_processing"] is False

    def test_returns_same_session_on_second_call(self):
        s1 = _session("sid-2")
        s1["state"] = "excited"
        s2 = _session("sid-2")
        assert s2["state"] == "excited"

    def test_different_sids_are_isolated(self):
        s1 = _session("sid-a")
        s2 = _session("sid-b")
        s1["state"] = "tired"
        assert s2["state"] == "neutral"

    def test_session_stored_in_sessions_dict(self):
        _session("sid-stored")
        assert "sid-stored" in _sessions


class TestCancelTts:
    async def test_cancels_active_task_and_emits_stop(self):
        from app.api.socketio_handlers import _cancel_tts

        mock_sio = AsyncMock()
        mock_task = AsyncMock()
        mock_task.done = MagicMock(return_value=False)
        mock_task.cancel = MagicMock()

        sess = _session("sid-tts")
        sess["tts_task"] = mock_task

        await _cancel_tts("sid-tts", mock_sio)

        mock_task.cancel.assert_called_once()
        mock_sio.emit.assert_called_with("stop_speaking", to="sid-tts")

    async def test_noop_when_no_tts_task(self):
        from app.api.socketio_handlers import _cancel_tts

        mock_sio = AsyncMock()
        _session("sid-no-task")

        await _cancel_tts("sid-no-task", mock_sio)

        mock_sio.emit.assert_not_called()

    async def test_noop_when_task_already_done(self):
        from app.api.socketio_handlers import _cancel_tts

        mock_sio = AsyncMock()
        mock_task = MagicMock()
        mock_task.done.return_value = True

        sess = _session("sid-done")
        sess["tts_task"] = mock_task

        await _cancel_tts("sid-done", mock_sio)

        mock_task.cancel.assert_not_called()

    async def test_removes_task_from_session_after_cancel(self):
        from app.api.socketio_handlers import _cancel_tts

        mock_sio = AsyncMock()
        mock_task = AsyncMock()
        mock_task.done = MagicMock(return_value=False)
        mock_task.cancel = MagicMock()

        sess = _session("sid-cleanup")
        sess["tts_task"] = mock_task

        await _cancel_tts("sid-cleanup", mock_sio)

        assert "tts_task" not in _session("sid-cleanup")


class TestGreetSpeaker:
    async def test_emits_greeting_with_name(self):
        from app.api.socketio_handlers import _greet_speaker

        mock_sio = AsyncMock()
        with patch("app.api.socketio_handlers.settings") as s:
            s.has_tts.return_value = False
            await _greet_speaker("sid-greet", "Alice", mock_sio)

        emitted_events = [call.args[0] for call in mock_sio.emit.call_args_list]
        assert "chat_token" in emitted_events
        assert "chat_response" in emitted_events

        token_call = next(c for c in mock_sio.emit.call_args_list if c.args[0] == "chat_token")
        assert "Alice" in token_call.args[1]
