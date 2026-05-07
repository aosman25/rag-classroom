import json
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from auth import issue_token, verify_admin
from embed_client import EmbedClient
from llm_client import LLMClient
from milvus_store import MilvusStore
from models import (
    AddChunksRequest,
    AddChunksResponse,
    AskRequest,
    ChunksResponse,
    DeleteChunkResponse,
    LoginRequest,
    LoginResponse,
    RetrievedSource,
    StoredChunk,
)

load_dotenv()

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")

state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["embed"] = EmbedClient()
    state["llm"] = LLMClient()
    state["store"] = MilvusStore()
    yield
    await state["embed"].aclose()


app = FastAPI(title="Classroom RAG API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/admin/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    if req.password != ADMIN_PASSWORD:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password")
    return LoginResponse(token=issue_token())


@app.post(
    "/admin/chunks",
    response_model=AddChunksResponse,
    dependencies=[Depends(verify_admin)],
)
async def add_chunks(req: AddChunksRequest):
    chunks = [c.strip() for c in req.chunks if c.strip()]
    if not chunks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No non-empty chunks provided")

    store: MilvusStore = state["store"]
    embed: EmbedClient = state["embed"]

    vectors = await embed.embed(chunks)
    inserted = store.add_chunks(chunks, vectors)
    return AddChunksResponse(inserted=inserted, total=store.count_chunks())


@app.delete(
    "/admin/chunks/{chunk_id}",
    response_model=DeleteChunkResponse,
    dependencies=[Depends(verify_admin)],
)
async def delete_chunk(chunk_id: str):
    try:
        chunk_id_int = int(chunk_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "chunk_id must be an integer")
    store: MilvusStore = state["store"]
    store.delete_chunk(chunk_id_int)
    return DeleteChunkResponse(deleted=1, total=store.count_chunks())


@app.delete(
    "/admin/chunks",
    response_model=DeleteChunkResponse,
    dependencies=[Depends(verify_admin)],
)
async def clear_all_chunks():
    store: MilvusStore = state["store"]
    before = store.count_chunks()
    store.clear_all()
    return DeleteChunkResponse(deleted=before, total=0)


@app.get("/chunks", response_model=ChunksResponse)
async def list_chunks():
    store: MilvusStore = state["store"]
    rows = store.list_chunks()
    return ChunksResponse(
        chunks=[StoredChunk(id=str(r["id"]), text=r["text"]) for r in rows],
        total=len(rows),
    )


@app.post("/ask")
async def ask(req: AskRequest):
    embed: EmbedClient = state["embed"]
    store: MilvusStore = state["store"]
    llm: LLMClient = state["llm"]

    async def event_stream():
        try:
            sources: list[RetrievedSource] = []
            if req.use_rag:
                [qvec] = await embed.embed([req.question])
                hits = store.search(qvec, req.top_k)
                sources = [
                    RetrievedSource(
                        id=str(h["id"]), text=h["text"], score=h["score"]
                    )
                    for h in hits
                ]
            yield (
                json.dumps(
                    {
                        "type": "sources",
                        "use_rag": req.use_rag,
                        "sources": [s.model_dump() for s in sources],
                    }
                )
                + "\n"
            )

            async for delta in llm.ask_stream(
                question=req.question,
                sources=sources,
                use_rag=req.use_rag,
                temperature=req.temperature,
            ):
                yield json.dumps({"type": "delta", "text": delta}) + "\n"

            yield json.dumps({"type": "done"}) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
