import pytest
from datetime import date
from unittest.mock import AsyncMock, patch


class TestDiaryWriter:
    async def test_skips_when_letta_unavailable(self):
        from app.workers.diary_writer import run

        with patch("app.workers.diary_writer.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.workers.diary_writer.send_message", new_callable=AsyncMock) as mock_send:
            await run({})

        mock_send.assert_not_called()

    async def test_sends_prompt_when_letta_available(self):
        from app.workers.diary_writer import run

        with patch("app.workers.diary_writer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.diary_writer.send_message",
                   new_callable=AsyncMock, return_value="Diary written.") as mock_send:
            await run({})

        mock_send.assert_called_once()

    async def test_prompt_includes_diary_marker(self):
        from app.workers.diary_writer import run

        captured = []

        async def capture(prompt, role=None):
            captured.append(prompt)
            return "entry"

        with patch("app.workers.diary_writer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.diary_writer.send_message", side_effect=capture):
            await run({})

        assert len(captured) == 1
        assert "DIARY" in captured[0] or "diary" in captured[0].lower()

    async def test_prompt_includes_current_date(self):
        from app.workers.diary_writer import run

        captured = []

        async def capture(prompt, role=None):
            captured.append(prompt)
            return "entry"

        fake_today = date(2026, 5, 7)
        with patch("app.workers.diary_writer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.diary_writer.send_message", side_effect=capture), \
             patch("app.workers.diary_writer.date") as mock_date:
            mock_date.today.return_value = fake_today
            await run({})

        assert "2026-05-07" in captured[0]

    async def test_handles_empty_letta_response_gracefully(self):
        from app.workers.diary_writer import run

        with patch("app.workers.diary_writer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.diary_writer.send_message",
                   new_callable=AsyncMock, return_value=None):
            await run({})  # must not raise

    async def test_sends_as_system_role(self):
        from app.workers.diary_writer import run

        with patch("app.workers.diary_writer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.diary_writer.send_message",
                   new_callable=AsyncMock, return_value="ok") as mock_send:
            await run({})

        call_kwargs = mock_send.call_args
        # role may be positional or keyword
        role = call_kwargs.kwargs.get("role") or (call_kwargs.args[1] if len(call_kwargs.args) > 1 else None)
        assert role == "system"
