# RAG Classroom

A self-contained classroom activity for teaching how Retrieval-Augmented
Generation (RAG) grounds an LLM's answers and reduces hallucinations.

The activity is built around a tight loop students can feel: hand-chunk a
piece of text, ingest it into a vector database, then ask the same question
twice — once with RAG **on** and once with RAG **off** — and compare.

---

## How the lesson runs

1. Pick a text whose specifics the LLM is unlikely to know in detail (a niche
   article, a fictional handbook, a short story, recent news). Hand each
   student a passage to chunk on paper or in a shared doc.
2. Collect the chunks. Sign in as **Admin**, paste them into the textarea
   (one chunk per line, blank lines OK), and click **Add**.
3. Send students to the public **Ask** page. They toggle **RAG on/off**, ask
   questions, and compare:
   - **RAG off** — the model answers from training data alone, no sources.
     Often vague, sometimes wrong, sometimes confidently invented.
   - **RAG on** — retrieval pulls the most relevant chunks. The model is
     constrained to answer **only** from those chunks and **cite** them
     inline as `[1]`, `[2, 3]`, etc.
4. Hovering any citation in the answer pops up the exact chunk text it
   refers to. Students can immediately verify whether the model is faithful.
5. Discuss the retrieval-score sidebar. When chunking is poor, top scores
   stay low and the model often says "the provided sources do not contain
   enough information." That is the lesson — *retrieval quality is bounded
   by chunk quality*.

---

## Stack

```
┌──────────────────────────────────────────────────────────┐
│  classroom-web (nginx)                                   │
│    Vite + React + Tailwind, /api → classroom-api proxy   │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│  classroom-api (FastAPI)                                 │
│    auth · ingest · retrieval · LLM streaming             │
│    └─ embeds via DeepInfra (BGE-M3, 1024-dim dense)      │
│    └─ generates via Google Gemini 2.5 Flash              │
└─────┬───────────────────────────────┬────────────────────┘
      │                               │
      ▼                               ▼
  ┌─────────┐                    ┌────────────┐
  │ Milvus  │                    │  DeepInfra │
  │ (HNSW + │                    │  Gemini    │
  │ cosine) │                    └────────────┘
  └─────────┘
```

Five Docker containers: `etcd`, `minio`, `milvus`, `classroom-api`,
`classroom-web`. Bring them all up with `docker compose up --build`.

---

## Setup

You will need:
- Docker + Docker Compose v2
- A **DeepInfra** key — for embeddings (https://deepinfra.com)
- A **Google Gemini** key — for the LLM (https://aistudio.google.com/app/apikey)

```bash
git clone https://github.com/aosman25/rag-classroom.git
cd rag-classroom
cp .env.example .env
# edit .env — fill in DEEPINFRA_API_KEY, GEMINI_API_KEY, ADMIN_PASSWORD
docker compose up --build
```

Open <http://localhost:8080>.

- **Ask** tab — public, for students.
- **Admin** tab — password from `ADMIN_PASSWORD` in `.env`.

First boot pulls Milvus images and installs npm/pip deps; allow ~3 minutes.

---

## Features

### Admin (`/admin`)

- **Password-gated** — JWT bearer token issued on login, stored in
  `localStorage`. The chunk-ingest endpoints are admin-only.
- **Single-textarea ingest** — paste all chunks, separated by line breaks
  (blank lines are also fine). A live counter shows how many chunks are
  detected as you type.
- **Stored-chunks panel** — every chunk gets a stable, simple ID (`1, 2, 3,
  …`). IDs persist across deletes (gaps are fine — citations stay
  meaningful).
- **Per-chunk delete** — click the red Delete button on any chunk; UI
  updates instantly via optimistic update.
- **Hover-expand** — chunk previews are line-clamped; hover to see the full
  text inline plus a system tooltip.
- **Reset** — wipes the whole collection in one click (with confirmation),
  by dropping and recreating the Milvus collection.

### Student (`/`)

- **RAG toggle** — flips between two LLM system prompts:
  - *No-RAG*: a neutral "answer clearly, say if you don't know" prompt.
  - *RAG*: strict — answer **only** from sources, cite inline as `[id]`,
    refuse if sources are insufficient.
- **Streaming markdown** — answers stream token-by-token via NDJSON. Bold,
  bullet lists, headings, GFM tables all render with `react-markdown` +
  `remark-gfm`. A blinking cursor marks the active stream.
- **Interactive citations** — `[1]`, `[1, 6]`, `[1,6,7]` are all parsed and
  each id becomes its own hover target showing the exact chunk text.
  Citations to non-retrieved ids render greyed out (no tooltip).
- **Retrieved-sources panel** — sidebar lists the chunks Milvus returned,
  with cosine similarity scores. Visible whenever RAG is on.
- **Top-k slider** — students can set 1–20 sources per query. Useful for
  showing how recall changes when retrieval is starved or flooded.
- **Advanced: temperature** — collapsed by default to keep the lesson
  focused on the RAG vs no-RAG contrast.
- **Copy answer** — small button next to the RAG badge copies the raw
  markdown to the clipboard. Falls back to `execCommand("copy")` if
  `navigator.clipboard` is unavailable (e.g. plain HTTP on a LAN IP).

---

## API surface

`classroom-api` is on the internal Docker network only; the frontend
proxies `/api/*` to it via nginx. To poke at it directly during a demo,
expose its port or `docker exec` into the container.

| Method | Path                         | Auth   | Body                                                                                |
| ------ | ---------------------------- | ------ | ----------------------------------------------------------------------------------- |
| POST   | `/admin/login`               | none   | `{password}`                                                                        |
| POST   | `/admin/chunks`              | admin  | `{chunks: string[]}`                                                                |
| DELETE | `/admin/chunks/{id}`         | admin  | —                                                                                   |
| DELETE | `/admin/chunks`              | admin  | — (clears all)                                                                      |
| GET    | `/chunks`                    | none   | —                                                                                   |
| POST   | `/ask`                       | none   | `{question, use_rag, top_k, temperature}` → NDJSON stream                           |
| GET    | `/health`                    | none   | —                                                                                   |

**`/ask` stream** emits NDJSON lines:
- `{"type":"sources","use_rag":bool,"sources":[…]}` — sent before any LLM tokens.
- `{"type":"delta","text":"…"}` — each Gemini chunk.
- `{"type":"done"}` or `{"type":"error","message":"…"}`.

---

## Configuration

All knobs live in `.env`:

| Variable             | Default                | Notes                                              |
| -------------------- | ---------------------- | -------------------------------------------------- |
| `DEEPINFRA_API_KEY`  | *(required)*           | For embeddings                                     |
| `GEMINI_API_KEY`     | *(required)*           | For LLM answers                                    |
| `GEMINI_MODEL`       | `gemini-2.5-flash`     | Any Gemini model with streaming support            |
| `EMBEDDING_MODEL`    | `BAAI/bge-m3-multi`    | Must produce 1024-dim vectors (matches `DENSE_DIM`)|
| `ADMIN_PASSWORD`     | `changeme`             | Change before class                                |
| `JWT_SECRET`         | `dev-secret-change-me` | Sign admin tokens                                  |

Data persists in named Docker volumes (`milvus_data`, `etcd_data`,
`minio_data`). To start completely fresh: `docker compose down -v`.

---

## Troubleshooting

**`classroom-api` keeps restarting on startup**
The Milvus instance takes a while to become healthy on first boot. The
api waits for Milvus's healthcheck, so give it ~90 seconds. If it doesn't
recover, check `docker logs classroom-milvus`.

**Streaming feels chunky / answer appears all at once**
The frontend uses streaming reads, but proxy buffering can collapse the
stream. The bundled `nginx.conf` already sets `proxy_buffering off;` and
the API sends `X-Accel-Buffering: no`. If you put another proxy in
front (cloud load balancer, ngrok, etc.), make sure it doesn't buffer.

**Copy button does nothing**
`navigator.clipboard` requires a secure context (HTTPS or `localhost`).
If you access the app over a LAN IP via plain HTTP, the button falls
back to `document.execCommand("copy")`, which works but is deprecated.

**The LLM answer cites an id you don't see in the sources**
The model may include a citation it imagined. Those render greyed-out
with no tooltip. Lower the temperature (Advanced → Temperature → 0.0)
to reduce this.

---

## Design notes

- **Why bypass the production search-service / ask-service?** Those services
  are coupled to the Islamic-library schema (book_id, author, Arabic
  prompts). The classroom needs a neutral, simple schema. The `classroom-api`
  talks to Milvus directly with a 3-field schema (`id, text, dense_vector`)
  and to Gemini directly with two neutral system prompts.
- **Why manual sequential IDs instead of Milvus auto_id?** Auto IDs are
  18-digit timestamps, which (a) overflow JavaScript's `Number.MAX_SAFE_INTEGER`
  if not carefully serialized, and (b) make citations look like noise. Manual
  IDs starting at `1` are stable, readable, and pedagogically clearer.
- **Why drop sparse / hybrid retrieval?** Dense-only is plenty for a lesson
  and keeps the retrieval story simple ("similar things have similar
  vectors"). Mixing in BM25 obscures the lesson without adding much.
- **Why disable Gemini "thinking"?** `thinking_budget=0` makes the first
  streamed token arrive almost immediately. Otherwise the model thinks
  silently for several seconds, which makes the streaming look broken.

---

## License

MIT.
