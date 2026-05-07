import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, RetrievedSource } from "../api";

export default function StudentView() {
  const [totalChunks, setTotalChunks] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [useRag, setUseRag] = useState(true);
  const [topK, setTopK] = useState(4);
  const [temperature, setTemperature] = useState(0.3);
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Streaming answer state
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<RetrievedSource[]>([]);
  const [answerRag, setAnswerRag] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .listChunks()
      .then((r) => setTotalChunks(r.total))
      .catch(() => setTotalChunks(null));
  }, []);

  function onAsk() {
    if (!question.trim() || loading) return;
    setError(null);
    setAnswer("");
    setSources([]);
    setAnswerRag(null);
    setLoading(true);
    api.askStream(
      {
        question,
        use_rag: useRag,
        top_k: topK,
        temperature,
      },
      {
        onSources: (s, rag) => {
          setSources(s);
          setAnswerRag(rag);
        },
        onDelta: (t) => setAnswer((prev) => prev + t),
        onError: (msg) => setError(msg),
        onDone: () => setLoading(false),
      }
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Ask a question</h2>
            {totalChunks !== null && (
              <span className="text-xs text-slate-500">
                {totalChunks} chunk{totalChunks === 1 ? "" : "s"} in the database
              </span>
            )}
          </div>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What do you want to know about the text?"
            rows={3}
            className="input resize-y"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onAsk}
              disabled={loading || !question.trim()}
              className="btn-primary"
            >
              {loading ? "Thinking…" : "Ask"}
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={useRag}
                onChange={(e) => setUseRag(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Use RAG (ground answer in retrieved chunks)
            </label>
          </div>

          {useRag && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="text-slate-700">Sources to retrieve:</label>
              <input
                type="number"
                min={1}
                max={20}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="input w-20"
              />
            </div>
          )}

          <button
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            {advanced ? "Hide" : "Show"} advanced options
          </button>
          {advanced && (
            <div className="flex items-center gap-3 text-sm">
              <label className="text-slate-700">
                Temperature: {temperature.toFixed(2)}
              </label>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-48"
              />
              <span className="text-xs text-slate-500">
                Higher = more creative / less faithful
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </section>

        {answerRag !== null && (
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Answer</h2>
              <div className="flex items-center gap-2">
                <CopyButton text={answer} disabled={loading || !answer} />
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    answerRag
                      ? "bg-indigo-50 text-indigo-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {answerRag ? "RAG ON" : "RAG OFF"}
                </span>
              </div>
            </div>
            <div className="prose prose-sm max-w-none text-slate-800 prose-p:my-2 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1.5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={makeMarkdownComponents(sources)}
              >
                {answer}
              </ReactMarkdown>
              {loading && (
                <span className="inline-block w-2 h-4 bg-slate-400 align-middle ml-0.5 animate-pulse" />
              )}
            </div>
            {!answerRag && !loading && (
              <p className="text-xs text-slate-500 italic">
                The model answered from its own training data only — no chunks
                were consulted.
              </p>
            )}
          </section>
        )}
      </div>

      <aside className="space-y-4">
        <section className="card p-5">
          <h2 className="text-base font-semibold mb-3">Retrieved sources</h2>
          {answerRag === false && (
            <p className="text-xs text-slate-500">
              Turn RAG on to see which chunks the model was given.
            </p>
          )}
          {answerRag === true && sources.length === 0 && (
            <p className="text-xs text-slate-500">No sources retrieved.</p>
          )}
          {answerRag === true && sources.length > 0 && (
            <ol className="space-y-3">
              {sources.map((s) => (
                <SourceCard key={s.id} source={s} />
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}

function renderCitedText(
  text: string,
  sourceById: Map<string, RetrievedSource>
): React.ReactNode[] {
  if (!text) return [];
  const parts: React.ReactNode[] = [];
  // Matches [1], [1,2], [1, 2, 3], etc.
  const re = /\[((?:\d+\s*,\s*)*\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const ids = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    parts.push(
      <CitationGroup
        key={`c${key++}`}
        ids={ids}
        sourceById={sourceById}
      />
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function processChildren(
  children: React.ReactNode,
  sourceById: Map<string, RetrievedSource>
): React.ReactNode {
  if (typeof children === "string") {
    return renderCitedText(children, sourceById);
  }
  if (!Array.isArray(children)) return children;
  return children.flatMap((child, i) => {
    if (typeof child === "string") {
      return renderCitedText(child, sourceById).map((node, j) =>
        typeof node === "string" ? node : { ...node, key: `${i}-${j}` }
      );
    }
    return child;
  });
}

function makeMarkdownComponents(sources: RetrievedSource[]) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const wrap =
    <T extends keyof JSX.IntrinsicElements>(Tag: T) =>
    ({ children, ...rest }: any) =>
      <Tag {...rest}>{processChildren(children, sourceById)}</Tag>;
  return {
    p: wrap("p"),
    li: wrap("li"),
    h1: wrap("h1"),
    h2: wrap("h2"),
    h3: wrap("h3"),
    h4: wrap("h4"),
    strong: wrap("strong"),
    em: wrap("em"),
    td: wrap("td"),
    th: wrap("th"),
    blockquote: wrap("blockquote"),
  };
}

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts (e.g. http on a LAN IP)
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={onCopy}
      disabled={disabled}
      className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 hover:border-slate-300 transition-colors"
      title="Copy answer to clipboard"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CitationGroup({
  ids,
  sourceById,
}: {
  ids: string[];
  sourceById: Map<string, RetrievedSource>;
}) {
  return (
    <span className="font-mono text-xs text-indigo-700 align-baseline">
      [
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && <span>, </span>}
          <CitationLink id={id} source={sourceById.get(id)} />
        </span>
      ))}
      ]
    </span>
  );
}

function CitationLink({
  id,
  source,
}: {
  id: string;
  source?: RetrievedSource;
}) {
  if (!source) {
    return <span className="text-slate-400">{id}</span>;
  }
  return (
    <span className="relative inline-block group">
      <span className="underline decoration-dotted underline-offset-2 cursor-help">
        {id}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20 w-72 rounded-md bg-slate-900 text-slate-100 p-2 shadow-lg whitespace-pre-wrap leading-snug normal-case font-sans"
      >
        <span className="block font-mono text-indigo-300 mb-1">[{id}]</span>
        {source.text}
      </span>
    </span>
  );
}

function SourceCard({ source }: { source: RetrievedSource }) {
  return (
    <li className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-indigo-700">[{source.id}]</span>
        <span className="text-xs text-slate-500">
          score {source.score.toFixed(3)}
        </span>
      </div>
      <p className="text-xs text-slate-700 whitespace-pre-wrap">
        {source.text}
      </p>
    </li>
  );
}
