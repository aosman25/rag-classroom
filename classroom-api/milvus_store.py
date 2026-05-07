import os
import time
from typing import List

from pymilvus import (
    CollectionSchema,
    DataType,
    FieldSchema,
    MilvusClient,
)

MILVUS_URI = os.getenv("MILVUS_URI", "http://milvus:19530")
MILVUS_TOKEN = os.getenv("MILVUS_TOKEN", "")
COLLECTION_NAME = os.getenv("MILVUS_COLLECTION", "classroom_chunks")
DENSE_DIM = int(os.getenv("DENSE_DIM", "1024"))


class MilvusStore:
    def __init__(self) -> None:
        self.client = MilvusClient(uri=MILVUS_URI, token=MILVUS_TOKEN or None)
        self._ensure_collection()

    def _ensure_collection(self) -> None:
        # If a previous (auto_id) collection exists, drop it so we can use
        # human-friendly sequential IDs.
        if self.client.has_collection(COLLECTION_NAME):
            try:
                info = self.client.describe_collection(COLLECTION_NAME)
                fields = info.get("fields", []) if isinstance(info, dict) else []
                id_field = next(
                    (f for f in fields if f.get("name") == "id"), None
                )
                if id_field and not id_field.get("auto_id", False):
                    return
            except Exception:
                pass
            self.client.drop_collection(COLLECTION_NAME)

        fields = [
            FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=False),
            FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=8192),
            FieldSchema(name="dense_vector", dtype=DataType.FLOAT_VECTOR, dim=DENSE_DIM),
        ]
        schema = CollectionSchema(fields=fields, description="Classroom RAG chunks")

        index_params = self.client.prepare_index_params()
        index_params.add_index(
            field_name="dense_vector",
            index_type="HNSW",
            metric_type="COSINE",
            params={"M": 16, "efConstruction": 200},
        )

        self.client.create_collection(
            collection_name=COLLECTION_NAME,
            schema=schema,
            index_params=index_params,
        )
        self.client.load_collection(COLLECTION_NAME)

    def _next_id(self) -> int:
        rows = self.client.query(
            collection_name=COLLECTION_NAME,
            filter="",
            output_fields=["id"],
            limit=10000,
            consistency_level="Strong",
        )
        if not rows:
            return 1
        return max(int(r["id"]) for r in rows) + 1

    def add_chunks(self, texts: List[str], vectors: List[List[float]]) -> int:
        next_id = self._next_id()
        rows = [
            {"id": next_id + i, "text": t, "dense_vector": v}
            for i, (t, v) in enumerate(zip(texts, vectors))
        ]
        self.client.insert(collection_name=COLLECTION_NAME, data=rows)
        self.client.flush(COLLECTION_NAME)
        return len(rows)

    def list_chunks(self) -> List[dict]:
        rows = self.client.query(
            collection_name=COLLECTION_NAME,
            filter="",
            output_fields=["id", "text"],
            limit=10000,
            consistency_level="Strong",
        )
        return sorted(rows, key=lambda r: r["id"])

    def count_chunks(self) -> int:
        rows = self.client.query(
            collection_name=COLLECTION_NAME,
            filter="",
            output_fields=["id"],
            limit=10000,
            consistency_level="Strong",
        )
        return len(rows)

    def delete_chunk(self, chunk_id: int) -> int:
        self.client.delete(collection_name=COLLECTION_NAME, ids=[chunk_id])
        self.client.flush(COLLECTION_NAME)
        time.sleep(0.2)
        return 1

    def clear_all(self) -> int:
        existed = self.client.has_collection(COLLECTION_NAME)
        if existed:
            self.client.drop_collection(COLLECTION_NAME)
        self._ensure_collection()
        return 1 if existed else 0

    def search(self, query_vector: List[float], top_k: int) -> List[dict]:
        results = self.client.search(
            collection_name=COLLECTION_NAME,
            data=[query_vector],
            anns_field="dense_vector",
            limit=top_k,
            output_fields=["id", "text"],
            search_params={"metric_type": "COSINE", "params": {"ef": 64}},
            consistency_level="Strong",
        )
        if not results:
            return []
        return [
            {"id": h["id"], "text": h["entity"]["text"], "score": float(h["distance"])}
            for h in results[0]
        ]
