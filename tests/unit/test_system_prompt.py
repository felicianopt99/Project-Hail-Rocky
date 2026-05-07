from app.rocky.personality.system_prompt import build_system_prompt


def test_contains_core_identity():
    prompt = build_system_prompt()
    assert "Rocky" in prompt
    assert "Eridian" in prompt


def test_tired_modifier_included():
    prompt = build_system_prompt(emotional_state="tired")
    assert "TIRED" in prompt


def test_excited_modifier_included():
    prompt = build_system_prompt(emotional_state="excited")
    assert "EXCITED" in prompt


def test_curious_modifier_included():
    prompt = build_system_prompt(emotional_state="curious")
    assert "CURIOUS" in prompt


def test_focused_modifier_included():
    prompt = build_system_prompt(emotional_state="focused")
    assert "FOCUSED" in prompt


def test_neutral_has_no_state_modifier():
    prompt = build_system_prompt(emotional_state="neutral")
    for state in ("TIRED", "EXCITED", "CURIOUS", "FOCUSED", "PLAYFUL"):
        assert state not in prompt


def test_unknown_state_does_not_crash():
    prompt = build_system_prompt(emotional_state="unknown_xyz")
    assert "Rocky" in prompt


def test_intimacy_score_in_prompt():
    prompt = build_system_prompt(intimacy_score=82.0)
    assert "82" in prompt


def test_home_summary_in_prompt():
    prompt = build_system_prompt(home_summary="Lights off, temperature 21°C.")
    assert "Lights off" in prompt


def test_includes_speech_mode_hint():
    prompt = build_system_prompt()
    assert any(m in prompt for m in ("TECHNICAL", "FORMAL", "CASUAL"))


def test_includes_temporal_context():
    prompt = build_system_prompt()
    assert "Time" in prompt or "Timezone" in prompt


def test_includes_home_assistant_section():
    prompt = build_system_prompt()
    assert "Home Assistant" in prompt
