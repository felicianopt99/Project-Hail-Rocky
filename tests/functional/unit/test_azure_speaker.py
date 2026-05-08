import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
from app.bridges import azure_speaker


class TestPcmToWav:
    def test_starts_with_riff_header(self):
        wav = azure_speaker._pcm_to_wav(b'\x00' * 200)
        assert wav[:4] == b'RIFF'
        assert wav[8:12] == b'WAVE'

    def test_total_size_is_44_plus_pcm(self):
        pcm = bytes(200)
        wav = azure_speaker._pcm_to_wav(pcm)
        assert len(wav) == 44 + 200

    def test_pcm_data_appended_at_end(self):
        pcm = b'\x10\x20' * 50
        wav = azure_speaker._pcm_to_wav(pcm)
        assert wav.endswith(pcm)

    def test_custom_sample_rate_encoded(self):
        import struct
        pcm = bytes(200)
        wav = azure_speaker._pcm_to_wav(pcm, sample_rate=8000)
        # sample_rate is at offset 24 in WAV header (little-endian uint32)
        sr = struct.unpack_from("<I", wav, 24)[0]
        assert sr == 8000


class TestProfileRegistry:
    async def test_load_profiles_returns_empty_without_redis(self):
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=None):
            result = await azure_speaker._load_profiles()
        assert result == {}

    async def test_load_profiles_parses_json(self):
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=json.dumps({"pid1": "Alice"}))
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await azure_speaker._load_profiles()
        assert result == {"pid1": "Alice"}

    async def test_load_profiles_returns_empty_on_missing_key(self):
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await azure_speaker._load_profiles()
        assert result == {}

    async def test_save_profiles_stores_json(self):
        mock_redis = AsyncMock()
        mock_redis.set = AsyncMock()
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            await azure_speaker._save_profiles({"pid1": "Bob"})
        mock_redis.set.assert_called_once_with(
            "rocky:speaker:profiles", json.dumps({"pid1": "Bob"})
        )


class TestSessionCache:
    async def test_get_cached_returns_none_without_redis(self):
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=None):
            result = await azure_speaker._get_cached("sid-1")
        assert result is None

    async def test_get_cached_returns_value(self):
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value="Alice")
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await azure_speaker._get_cached("sid-1")
        assert result == "Alice"

    async def test_set_cached_stores_with_ttl(self):
        mock_redis = AsyncMock()
        mock_redis.setex = AsyncMock()
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            await azure_speaker._set_cached("sid-1", "Alice")
        mock_redis.setex.assert_called_once_with(
            "rocky:speaker:session:sid-1",
            azure_speaker._UTTERANCE_TTL,
            "Alice",
        )

    async def test_clear_session_deletes_key(self):
        mock_redis = AsyncMock()
        mock_redis.delete = AsyncMock()
        with patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            await azure_speaker.clear_session("sid-1")
        mock_redis.delete.assert_called_once_with("rocky:speaker:session:sid-1")


class TestCreateProfile:
    async def test_creates_profile_and_stores_mapping(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"profileId": "azure-pid-1"}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=mock_resp)

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        with patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client), \
             patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key123"
            result = await azure_speaker.create_profile("Bob")

        assert result == "azure-pid-1"

    async def test_returns_none_on_exception(self):
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(side_effect=Exception("network error"))
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key"
            result = await azure_speaker.create_profile("Bob")
        assert result is None


class TestIdentify:
    async def test_returns_cached_speaker_when_audio_too_short(self):
        short_pcm = b'\x00' * 100
        with patch("app.bridges.azure_speaker._get_cached", new_callable=AsyncMock, return_value="Alice"):
            result = await azure_speaker.identify(short_pcm, "sid-1")
        assert result == {"name": "Alice", "changed": False}

    async def test_returns_none_when_short_audio_and_no_cache(self):
        short_pcm = b'\x00' * 100
        with patch("app.bridges.azure_speaker._get_cached", new_callable=AsyncMock, return_value=None), \
             patch("app.bridges.azure_speaker._load_profiles", new_callable=AsyncMock, return_value={}):
            result = await azure_speaker.identify(short_pcm, "sid-1")
        assert result is None

    async def test_identifies_speaker_with_high_confidence(self):
        pcm = b'\x10' * 40000
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"identifiedProfile": {"profileId": "pid1", "score": 0.85}}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("app.bridges.azure_speaker._get_cached", new_callable=AsyncMock, return_value=None), \
             patch("app.bridges.azure_speaker._load_profiles", new_callable=AsyncMock, return_value={"pid1": "Alice"}), \
             patch("app.bridges.azure_speaker._set_cached", new_callable=AsyncMock), \
             patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key"
            s.has_speaker_id.return_value = True
            result = await azure_speaker.identify(pcm, "sid-1")

        assert result == {"name": "Alice", "changed": False}

    async def test_keeps_cached_on_low_confidence(self):
        pcm = b'\x10' * 40000
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"identifiedProfile": {"profileId": "pid1", "score": 0.3}}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("app.bridges.azure_speaker._get_cached", new_callable=AsyncMock, return_value="Bob"), \
             patch("app.bridges.azure_speaker._load_profiles", new_callable=AsyncMock, return_value={"pid1": "Alice"}), \
             patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key"
            s.has_speaker_id.return_value = True
            result = await azure_speaker.identify(pcm, "sid-1")

        assert result == {"name": "Bob", "changed": False}

    async def test_detects_speaker_change(self):
        pcm = b'\x10' * 40000
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"identifiedProfile": {"profileId": "pid2", "score": 0.9}}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("app.bridges.azure_speaker._get_cached", new_callable=AsyncMock, return_value="Alice"), \
             patch("app.bridges.azure_speaker._load_profiles", new_callable=AsyncMock, return_value={"pid2": "Bob"}), \
             patch("app.bridges.azure_speaker._set_cached", new_callable=AsyncMock), \
             patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key"
            s.has_speaker_id.return_value = True
            result = await azure_speaker.identify(pcm, "sid-1")

        assert result == {"name": "Bob", "changed": True}

    async def test_returns_cached_on_azure_exception(self):
        pcm = b'\x10' * 40000
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(side_effect=Exception("azure down"))
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("app.bridges.azure_speaker._get_cached", new_callable=AsyncMock, return_value="Alice"), \
             patch("app.bridges.azure_speaker._load_profiles", new_callable=AsyncMock, return_value={"pid1": "Alice"}), \
             patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key"
            s.has_speaker_id.return_value = True
            result = await azure_speaker.identify(pcm, "sid-1")

        assert result == {"name": "Alice", "changed": False}


class TestListProfiles:
    async def test_returns_formatted_list(self):
        with patch("app.bridges.azure_speaker._load_profiles",
                   new_callable=AsyncMock, return_value={"p1": "Alice", "p2": "Bob"}):
            result = await azure_speaker.list_profiles()

        assert len(result) == 2
        assert {"profile_id": "p1", "name": "Alice"} in result
        assert {"profile_id": "p2", "name": "Bob"} in result

    async def test_returns_empty_list_when_no_profiles(self):
        with patch("app.bridges.azure_speaker._load_profiles",
                   new_callable=AsyncMock, return_value={}):
            result = await azure_speaker.list_profiles()
        assert result == []


class TestDeleteProfile:
    async def test_deletes_from_azure_and_redis(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.delete = AsyncMock(return_value=mock_resp)

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=json.dumps({"pid1": "Alice", "pid2": "Bob"}))
        mock_redis.set = AsyncMock()

        with patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client), \
             patch("app.bridges.azure_speaker.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key"
            result = await azure_speaker.delete_profile("pid1")

        assert result is True

    async def test_returns_false_on_exception(self):
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(side_effect=Exception("network"))
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("app.bridges.azure_speaker.settings") as s, \
             patch("app.bridges.azure_speaker.httpx.AsyncClient", return_value=mock_client):
            s.azure_speaker_region = "westeurope"
            s.azure_speaker_key = "key"
            result = await azure_speaker.delete_profile("pid1")

        assert result is False
