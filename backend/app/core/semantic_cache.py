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

    async def check(self, prompt: str) -> Optional[Dict[str, Any]]:
        """
        Check if a similar prompt exists in the cache.
        Returns a dict with 'response' and 'score' if found, else None.
        """
        if not self.cache:
            return None
        
        # We need distance to calculate score
        # SemanticCache.check doesn't return distance by default in all versions
        # We can use the underlying vector store if needed, but let's see if 
        # SemanticCache returns it in results.
        try:
            # SemanticCache.check is synchronous in some versions
            # We use num_results=1 to get the best match
            results = self.cache.check(prompt=prompt, num_results=1)
            if results:
                # In Redis-VL 0.3+, results[0] is a dict with 'cache_entry'
                # and 'vector_distance' if it was found via search.
                # However, the SemanticCache.check signature might vary.
                # Let's assume it has what we need or we fallback gracefully.
                response = results[0].get("cache_entry")
                distance = results[0].get("vector_distance", 0.0)
                score = 1.0 - float(distance)
                
                log.info("semantic_cache_hit", 
                         prompt=prompt[:50], 
                         score=round(score, 4),
                         threshold=settings.semantic_cache_threshold)
                
                return {
                    "response": response,
                    "score": score
                }
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

    async def close(self):
        """
        Close the Redis connection of the semantic cache.
        """
        if self.cache and hasattr(self.cache, "redis"):
            try:
                # SemanticCache.redis might be a sync or async client
                # In newer redis-vl it can be async. We try to close it.
                if hasattr(self.cache.redis, "aclose"):
                    await self.cache.redis.aclose()
                elif hasattr(self.cache.redis, "close"):
                    # If it's sync, closing it won't hurt
                    self.cache.redis.close()
                log.info("semantic_cache_closed")
            except Exception as e:
                log.warning("semantic_cache_close_failed", error=str(e))

# Singleton instance
semantic_cache = RockySemanticCache()
