import pytest
from datetime import timedelta
from unittest.mock import AsyncMock, patch
from app.core.security import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
    blacklist_token, is_blacklisted,
)

_SECRET = "a" * 64


class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        h = hash_password("mypassword")
        assert h != "mypassword"
        assert h.startswith("$2b$")

    def test_verify_correct_password(self):
        h = hash_password("correct")
        assert verify_password("correct", h) is True

    def test_reject_wrong_password(self):
        h = hash_password("correct")
        assert verify_password("wrong", h) is False

    def test_different_hashes_for_same_password(self):
        h1 = hash_password("pw")
        h2 = hash_password("pw")
        assert h1 != h2  # bcrypt uses random salt


class TestTokens:
    def test_create_and_decode_access_token(self):
        with patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            token = create_access_token({"sub": "admin"})
            payload = decode_token(token)
        assert payload is not None
        assert payload["sub"] == "admin"

    def test_token_with_custom_expiry(self):
        with patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            token = create_access_token({"sub": "admin"}, expires_delta=timedelta(hours=2))
            payload = decode_token(token)
        assert payload is not None

    def test_refresh_token_has_longer_expiry(self):
        with patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            access = create_access_token({"sub": "admin"})
            refresh = create_refresh_token({"sub": "admin"})
        with patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            pa = decode_token(access)
            pr = decode_token(refresh)
        assert pr["exp"] > pa["exp"]

    def test_decode_invalid_token_returns_none(self):
        with patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            result = decode_token("not.a.token")
        assert result is None

    def test_decode_with_wrong_secret_returns_none(self):
        with patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            token = create_access_token({"sub": "admin"})
        with patch("app.core.security.settings") as s:
            s.secret_key = "b" * 64
            result = decode_token(token)
        assert result is None

    def test_decode_empty_string_returns_none(self):
        with patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            result = decode_token("")
        assert result is None


class TestBlacklist:
    async def test_blacklist_token_stores_in_redis(self):
        mock_redis = AsyncMock()
        mock_redis.setex = AsyncMock()
        with patch("app.core.security.settings") as s, \
             patch("app.core.redis_client.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            s.secret_key = _SECRET
            token = create_access_token({"sub": "admin"})
            await blacklist_token(token)
        mock_redis.setex.assert_called_once()
        key_used = mock_redis.setex.call_args[0][0]
        assert "rocky:token:blacklist:" in key_used

    async def test_blacklist_noop_when_no_redis(self):
        with patch("app.core.security.settings") as s, \
             patch("app.core.redis_client.get_redis", new_callable=AsyncMock, return_value=None):
            s.secret_key = _SECRET
            token = create_access_token({"sub": "admin"})
            await blacklist_token(token)  # must not raise

    async def test_blacklist_noop_on_invalid_token(self):
        mock_redis = AsyncMock()
        with patch("app.core.redis_client.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.core.security.settings") as s:
            s.secret_key = _SECRET
            await blacklist_token("invalid-token")
        mock_redis.setex.assert_not_called()

    async def test_is_blacklisted_true_when_key_exists(self):
        mock_redis = AsyncMock()
        mock_redis.exists = AsyncMock(return_value=1)
        with patch("app.core.redis_client.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await is_blacklisted("some-token")
        assert result is True

    async def test_is_blacklisted_false_when_key_missing(self):
        mock_redis = AsyncMock()
        mock_redis.exists = AsyncMock(return_value=0)
        with patch("app.core.redis_client.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await is_blacklisted("some-token")
        assert result is False

    async def test_is_blacklisted_false_when_no_redis(self):
        with patch("app.core.redis_client.get_redis", new_callable=AsyncMock, return_value=None):
            result = await is_blacklisted("any-token")
        assert result is False

    async def test_is_blacklisted_false_on_redis_exception(self):
        mock_redis = AsyncMock()
        mock_redis.exists = AsyncMock(side_effect=Exception("redis error"))
        with patch("app.core.redis_client.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await is_blacklisted("any-token")
        assert result is False
