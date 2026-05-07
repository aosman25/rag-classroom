import os
from typing import List

import httpx

DEEPINFRA_API_KEY = os.getenv("DEEPINFRA_API_KEY")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3-multi")
DEEPINFRA_API_URL = (
    f"https://api.deepinfra.com/v1/inference/{EMBEDDING_MODEL}"
)
EMBED_TIMEOUT = float(os.getenv("EMBED_TIMEOUT", "60"))
MAX_BATCH = int(os.getenv("EMBED_MAX_BATCH", "10"))


class EmbedClient:
    """Calls DeepInfra to generate dense embeddings for text chunks."""

    def __init__(self) -> None:
        if not DEEPINFRA_API_KEY:
            raise RuntimeError("DEEPINFRA_API_KEY is required")
        self._client = httpx.AsyncClient(timeout=EMBED_TIMEOUT)

    async def embed(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        out: List[List[float]] = []
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DEEPINFRA_API_KEY}",
        }
        for i in range(0, len(texts), MAX_BATCH):
            batch = texts[i : i + MAX_BATCH]
            resp = await self._client.post(
                DEEPINFRA_API_URL,
                headers=headers,
                json={
                    "inputs": batch,
                    "dense": True,
                    "sparse": False,
                    "colbert": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            out.extend(data["embeddings"])
        return out

    async def aclose(self) -> None:
        await self._client.aclose()
