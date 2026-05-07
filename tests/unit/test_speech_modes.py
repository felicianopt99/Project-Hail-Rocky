from app.rocky.personality.speech_modes import detect, hint


class TestDetect:
    def test_technical_on_code_keyword(self):
        assert detect("debug this python function", 50.0) == "technical"

    def test_technical_on_docker(self):
        assert detect("docker container is failing", 80.0) == "technical"

    def test_technical_on_api(self):
        assert detect("the api endpoint is broken", 35.0) == "technical"

    def test_formal_when_low_intimacy(self):
        assert detect("hello there", 20.0) == "formal"

    def test_formal_at_exact_boundary(self):
        # score < 30 → formal
        assert detect("hello", 29.9) == "formal"

    def test_casual_at_boundary(self):
        # score >= 30 and no tech keyword → casual
        assert detect("hello", 30.0) == "casual"

    def test_casual_by_default(self):
        assert detect("what's the weather like?", 50.0) == "casual"

    def test_technical_overrides_low_intimacy(self):
        # Tech keyword wins even with intimacy below 30
        assert detect("debug this", 10.0) == "technical"

    def test_multilingual_tech_keyword(self):
        assert detect("o código tem um erro", 50.0) == "technical"


class TestHint:
    def test_technical_hint_contains_mode_name(self):
        assert "TECHNICAL" in hint("technical")

    def test_formal_hint_contains_mode_name(self):
        assert "FORMAL" in hint("formal")

    def test_casual_hint_contains_mode_name(self):
        assert "CASUAL" in hint("casual")

    def test_unknown_mode_falls_back_to_casual(self):
        assert "CASUAL" in hint("nonexistent")

    def test_all_hints_are_non_empty_strings(self):
        for mode in ("technical", "formal", "casual"):
            assert isinstance(hint(mode), str) and hint(mode)
