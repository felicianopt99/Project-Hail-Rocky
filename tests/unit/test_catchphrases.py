import pytest
from unittest.mock import patch
from app.rocky.personality import catchphrases


class TestGet:
    def test_returns_empty_when_probability_not_met(self):
        with patch("app.rocky.personality.catchphrases.random.random", return_value=0.9):
            result = catchphrases.get("greeting", probability=0.5)
        assert result == ""

    def test_returns_phrase_when_probability_met(self):
        with patch("app.rocky.personality.catchphrases.random.random", return_value=0.0), \
             patch("app.rocky.personality.catchphrases.random.choice", return_value="Yes?"):
            result = catchphrases.get("greeting", probability=0.5)
        assert result == "Yes?"

    def test_unknown_context_falls_back_to_confirmation(self):
        with patch("app.rocky.personality.catchphrases.random.random", return_value=0.0), \
             patch("app.rocky.personality.catchphrases.random.choice") as mock_choice:
            mock_choice.return_value = "Understood."
            catchphrases.get("nonexistent_context", probability=1.0)
        mock_choice.assert_called_once_with(catchphrases._LIBRARY["confirmation"])

    def test_all_contexts_return_string(self):
        for context in catchphrases._LIBRARY:
            with patch("app.rocky.personality.catchphrases.random.random", return_value=0.0):
                result = catchphrases.get(context, probability=1.0)
            assert isinstance(result, str)
            assert len(result) > 0

    def test_default_probability_is_025(self):
        # probability=0.25 means random > 0.25 → empty; random <= 0.25 → phrase
        with patch("app.rocky.personality.catchphrases.random.random", return_value=0.5):
            result = catchphrases.get("greeting")
        assert result == ""

    def test_library_has_all_expected_contexts(self):
        expected = {"greeting", "confirmation", "impressed", "celebration", "farewell"}
        assert expected.issubset(set(catchphrases._LIBRARY.keys()))

    def test_library_phrases_are_non_empty(self):
        for context, phrases in catchphrases._LIBRARY.items():
            assert len(phrases) > 0, f"Context '{context}' has no phrases"
            for phrase in phrases:
                assert len(phrase.strip()) > 0


class TestHint:
    def test_wraps_phrase_correctly(self):
        with patch("app.rocky.personality.catchphrases.get", return_value="Amaze."):
            result = catchphrases.hint("impressed")
        assert "Amaze." in result
        assert result.startswith(" You may naturally weave in:")

    def test_returns_empty_when_no_phrase(self):
        with patch("app.rocky.personality.catchphrases.get", return_value=""):
            result = catchphrases.hint("confirmation")
        assert result == ""

    def test_hint_passthrough_probability(self):
        with patch("app.rocky.personality.catchphrases.get") as mock_get:
            mock_get.return_value = ""
            catchphrases.hint("greeting", probability=0.9)
        mock_get.assert_called_once_with("greeting", 0.9)
