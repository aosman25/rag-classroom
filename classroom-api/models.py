from typing import List, Optional
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str


class AddChunksRequest(BaseModel):
    chunks: List[str] = Field(..., min_length=1, max_length=200)


class AddChunksResponse(BaseModel):
    inserted: int
    total: int


class StoredChunk(BaseModel):
    id: str
    text: str


class ChunksResponse(BaseModel):
    chunks: List[StoredChunk]
    total: int


class DeleteChunkResponse(BaseModel):
    deleted: int
    total: int


class RetrievedSource(BaseModel):
    id: str
    text: str
    score: float


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    use_rag: bool = True
    top_k: int = Field(default=4, ge=1, le=10)
    temperature: float = Field(default=0.3, ge=0.0, le=1.5)


class AskResponse(BaseModel):
    answer: str
    use_rag: bool
    sources: List[RetrievedSource] = []
