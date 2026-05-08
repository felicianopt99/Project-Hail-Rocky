import pytest
from unittest.mock import AsyncMock, patch


class TestPatternAnalyzer:
    async def test_skips_when_letta_unavailable(self):
        from app.workers.pattern_analyzer import run

        with patch("app.workers.pattern_analyzer.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.workers.pattern_analyzer.send_message", new_callable=AsyncMock) as mock_send:
            await run({})

        mock_send.assert_not_called()

    async def test_sends_prompt_when_letta_available(self):
        from app.workers.pattern_analyzer import run

        with patch("app.workers.pattern_analyzer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.pattern_analyzer.send_message",
                   new_callable=AsyncMock, return_value="Analysis done.") as mock_send:
            await run({})

        mock_send.assert_called_once()

    async def test_prompt_asks_about_patterns(self):
        from app.workers.pattern_analyzer import run

        captured = []

        async def capture(prompt, role=None):
            captured.append(prompt)
            return "done"

        with patch("app.workers.pattern_analyzer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.pattern_analyzer.send_message", side_effect=capture):
            await run({})

        assert len(captured) == 1
        assert "pattern" in captured[0].lower() or "memory" in captured[0].lower()

    async def test_prompt_mentions_human(self):
        from app.workers.pattern_analyzer import run

        captured = []

        async def capture(prompt, role=None):
            captured.append(prompt)
            return "done"

        with patch("app.workers.pattern_analyzer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.pattern_analyzer.send_message", side_effect=capture):
            await run({})

        assert "human" in captured[0].lower()

    async def test_handles_empty_response_gracefully(self):
        from app.workers.pattern_analyzer import run

        with patch("app.workers.pattern_analyzer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.pattern_analyzer.send_message",
                   new_callable=AsyncMock, return_value=None):
            await run({})  # must not raise

    async def test_sends_as_system_role(self):
        from app.workers.pattern_analyzer import run

        with patch("app.workers.pattern_analyzer.is_available", new_callable=AsyncMock, return_value=True), \
             patch("app.workers.pattern_analyzer.send_message",
                   new_callable=AsyncMock, return_value="ok") as mock_send:
            await run({})

        call_kwargs = mock_send.call_args
        role = call_kwargs.kwargs.get("role") or (call_kwargs.args[1] if len(call_kwargs.args) > 1 else None)
        assert role == "system"
