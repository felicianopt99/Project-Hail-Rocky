import structlog
import numpy as np
from typing import Optional, List, Dict, Any
from redisvl.extensions.llmcache import SemanticCache
from redisvl.utils.vectorize import LiteLLMTextVectorizer
from ..config import settings

log = structlog.get_logger()

class RockySemanticCache:
    """
    Semantic Cache for Rocky's responses using Redis and Redis-VL.
    Reduces latency by returning cached responses for similar queries.
    """
    def __init__(self):
        if not settings.semantic_cache_enabled:
            self.cache = None
            return

        try:
            # Initialize the vectorizer (LiteLLM)
            # We use LiteLLM to be consistent with the rest of the app
            self.vectorizer = LiteLLMTextVectorizer(
                model=settings.embedding_model or "openai/text-embedding-3-small"
            )

            # Initialize the Semantic Cache
            # Score 0.95 similarity roughly translates to 0.05 distance for Cosine
            self.cache = SemanticCache(
                name="rocky_semantic_cache",
                prefix="cache",
                redis_url=settings.redis_url,
                distance_threshold=1 - settings.semantic_cache_threshold,
                vectorizer=self.vectorizer
            )
            log.info("semantic_cache_initialized", threshold=settings.semantic_cache_threshold)
        except Exception as e:
            log.error("semantic_cache_init_failed", error=str(e))
            self.cache = None

    async def check(self, prompt: str) -> Optional[str]:
        """
        Check if a similar prompt exists in the cache.
        Returns the response if found, else None.
        """
        if not self.cache:
            return None

        try:
            # SemanticCache.check is synchronous in some versions, but let's check if it's async-friendly
            # Redis-VL 0.3.0+ has some async support but SemanticCache might still be sync-wrapper
            results = self.cache.check(prompt=prompt, num_results=1)
            if results:
                log.info("semantic_cache_hit", prompt=prompt[:50])
                return results[0]["cache_entry"]
            return None
        except Exception as e:
            log.warning("semantic_cache_check_failed", error=str(e))
            return None

    async def store(self, prompt: str, response: str, metadata: Optional[Dict[str, Any]] = None):
        """
        Store a prompt-response pair in the cache.
        """
        if not self.cache:
            return

        try:
            self.cache.store(
                prompt=prompt,
                response=response,
                metadata=metadata or {}
            )
            log.debug("semantic_cache_stored", prompt=prompt[:50])
        except Exception as e:
            log.warning("semantic_cache_store_failed", error=str(e))

# Singleton instance
semantic_cache = RockySemanticCache()
