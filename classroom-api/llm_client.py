import asyncio
import os
from typing import AsyncGenerator, List

from google import genai
from google.genai import types

from models import RetrievedSource

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

NEUTRAL_SYSTEM_INSTRUCTION = (
    "You are a helpful assistant. Answer the user's question clearly and concisely. "
    "If you do not know the answer, say so plainly. Do not invent facts."
)

RAG_SYSTEM_INSTRUCTION = (
    "You are a helpful assistant. Answer the user's question using ONLY the provided "
    "sources. Each source has an ID like [3]. When you use information from a source, "
    "cite it inline like this: [3]. If the sources do not contain the answer, say "
    "\"The provided sources do not contain enough information to answer this question.\" "
    "Do not invent facts and do not use any knowledge outside the sources."
)


class LLMClient:
    def __init__(self) -> None:
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is required")
        self._client = genai.Client(api_key=GEMINI_API_KEY)

    async def ask_stream(
        self,
        question: str,
        sources: List[RetrievedSource],
        use_rag: bool,
        temperature: float,
    ) -> AsyncGenerator[str, None]:
        if use_rag:
            system = RAG_SYSTEM_INSTRUCTION
            prompt = _build_rag_prompt(question, sources)
        else:
            system = NEUTRAL_SYSTEM_INSTRUCTION
            prompt = question

        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=2048,
            # Disable Gemini 2.5 "thinking" so the first token arrives quickly
            # — otherwise the model thinks silently and the user sees a long pause.
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )

        # The SDK's async streaming variant collapses the stream into a single
        # response in this version; the sync iterator is what actually yields
        # incrementally. Bridge it to async via a thread + queue (same pattern
        # used by the main ask-service).
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()

        def _consume_sync_stream() -> None:
            try:
                stream = self._client.models.generate_content_stream(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=config,
                )
                for chunk in stream:
                    text = _extract_chunk_text(chunk)
                    if text:
                        loop.call_soon_threadsafe(queue.put_nowait, text)
            except Exception as e:
                loop.call_soon_threadsafe(
                    queue.put_nowait, _StreamError(str(e))
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

        loop.run_in_executor(None, _consume_sync_stream)

        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            if isinstance(item, _StreamError):
                raise RuntimeError(item.message)
            yield item


class _StreamError:
    def __init__(self, message: str) -> None:
        self.message = message


def _extract_chunk_text(chunk) -> str:
    """Pull text out of a Gemini stream chunk, falling back through fields."""
    text = getattr(chunk, "text", None)
    if text:
        return text
    candidates = getattr(chunk, "candidates", None) or []
    out = ""
    for cand in candidates:
        content = getattr(cand, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", None) or []:
            t = getattr(part, "text", None)
            if t:
                out += t
    return out


def _build_rag_prompt(question: str, sources: List[RetrievedSource]) -> str:
    if not sources:
        return (
            f"Question: {question}\n\n"
            "Sources: (none provided)\n\n"
            "Following the system instruction, answer using only the sources."
        )
    blocks = [f"[{s.id}] {s.text.strip()}" for s in sources]
    sources_block = "\n\n".join(blocks)
    return (
        f"Sources:\n{sources_block}\n\n"
        f"Question: {question}\n\n"
        "Answer the question using only the sources above. Cite source IDs inline like [3]."
    )
