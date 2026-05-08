import pytest
from datetime import date
from unittest.mock import patch
from app.rocky.personality import easter_eggs


class TestGetForTopic:
    def test_returns_empty_when_probability_not_met(self):
        with patch("app.rocky.personality.easter_eggs.random.random", return_value=0.99):
            result = easter_eggs.get_for_topic("solar energy", probability=0.15)
        assert result == ""

    def test_returns_ref_for_matched_energy_keyword(self):
        with patch("app.rocky.personality.easter_eggs.random.random", return_value=0.0), \
             patch("app.rocky.personality.easter_eggs.random.choice",
                   return_value=easter_eggs._REFS["energy"][0]):
            result = easter_eggs.get_for_topic("I love solar energy", probability=1.0)
        assert result == easter_eggs._REFS["energy"][0]

    def test_returns_empty_for_unmatched_message(self):
        with patch("app.rocky.personality.easter_eggs.random.random", return_value=0.0):
            result = easter_eggs.get_for_topic("random unrelated text xyz", probability=1.0)
        assert result == ""

    def test_music_keyword_triggers_music_refs(self):
        with patch("app.rocky.personality.easter_eggs.random.random", return_value=0.0), \
             patch("app.rocky.personality.easter_eggs.random.choice") as mock_choice:
            mock_choice.return_value = easter_eggs._REFS["music"][0]
            result = easter_eggs.get_for_topic("let's play some music", probability=1.0)
        mock_choice.assert_called_with(easter_eggs._REFS["music"])

    def test_sleep_keyword_triggers_sleep_refs(self):
        with patch("app.rocky.personality.easter_eggs.random.random", return_value=0.0), \
             patch("app.rocky.personality.easter_eggs.random.choice") as mock_choice:
            mock_choice.return_value = easter_eggs._REFS["sleep"][0]
            easter_eggs.get_for_topic("I need to sleep", probability=1.0)
        mock_choice.assert_called_with(easter_eggs._REFS["sleep"])

    def test_all_trigger_topics_have_refs(self):
        for topic in easter_eggs._TOPIC_TRIGGERS:
            assert topic in easter_eggs._REFS, f"'{topic}' has triggers but no refs"
            assert len(easter_eggs._REFS[topic]) > 0

    def test_case_insensitive_matching(self):
        with patch("app.rocky.personality.easter_eggs.random.random", return_value=0.0), \
             patch("app.rocky.personality.easter_eggs.random.choice",
                   return_value=easter_eggs._REFS["energy"][0]):
            result = easter_eggs.get_for_topic("SOLAR ENERGY IS AMAZING", probability=1.0)
        assert result != ""


class TestGetSpecialDate:
    def test_april_12_is_special(self):
        fake_today = date(2026, 4, 12)
        with patch("app.rocky.personality.easter_eggs.date") as mock_date:
            mock_date.today.return_value = fake_today
            result = easter_eggs.get_special_date()
        assert len(result) > 0

    def test_july_20_is_special(self):
        fake_today = date(2026, 7, 20)
        with patch("app.rocky.personality.easter_eggs.date") as mock_date:
            mock_date.today.return_value = fake_today
            result = easter_eggs.get_special_date()
        assert len(result) > 0

    def test_ordinary_date_returns_empty(self):
        fake_today = date(2026, 3, 15)
        with patch("app.rocky.personality.easter_eggs.date") as mock_date:
            mock_date.today.return_value = fake_today
            result = easter_eggs.get_special_date()
        assert result == ""

    def test_all_special_dates_have_valid_months_days(self):
        for (month, day), text in easter_eggs._SPECIAL_DATES.items():
            assert 1 <= month <= 12
            assert 1 <= day <= 31
            assert isinstance(text, str)
            assert len(text) > 0
