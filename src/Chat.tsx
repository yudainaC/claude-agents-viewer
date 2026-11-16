import { useUsage } from "./Usage.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "../server/types.ts";
import { Markdown } from "./markdown.tsx";

type Mode = "default" | "acceptEdits" | "plan";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "default", label: "Demander avant d'agir", hint: "Claude te demande la permission avant de modifier un fichier ou de lancer une commande." },
  { id: "acceptEdits", label: "Modifs automatiques", hint: "Claude modifie les fichiers sans demander, mais demande toujours avant les commandes." },
  { id: "plan", label: "Plan seulement", hint: "Claude explore et propose un plan, sans rien modifier." },
];

type Item =
  | { type: "user"; text: string }
  | { type: "text"; text: string; streaming: boolean }
  | { type: "tool"; id: string; name: string; summary: string; detail?: string; status: "running" | "ok" | "error"; preview?: string; steps: string[] }
  | { type: "permission"; id: string; tool: string; summary: string; detail?: string; answer?: boolean }
  | { type: "result"; ok: boolean; costUsd?: number; durationMs?: number; message?: string }
  | { type: "error"; message: string };

/** Applique un événement du serveur à la liste affichée. */
function reduce(items: Item[], ev: ChatEvent): Item[] {
  const next = items.slice();
  const last = next[next.length - 1];
  switch (ev.kind) {
    case "user":
      next.push({ type: "user", text: ev.text });
      break;
    case "text-delta":
      if (last?.type === "text" && last.streaming) next[next.length - 1] = { ...last, text: last.text + ev.text };
      else next.push({ type: "text", text: ev.text, streaming: true });
      break;
    case "text":
      if (last?.type === "text" && last.streaming) next[next.length - 1] = { type: "text", text: ev.text, streaming: false };
      else next.push({ type: "text", text: ev.text, streaming: false });
      break;
    case "tool":
      next.push({ type: "tool", id: ev.id, name: ev.name, summary: ev.summary, detail: ev.detail, status: "running", steps: [] });
      break;
    case "tool-result": {
      const i = next.findIndex((x) => x.type === "tool" && x.id === ev.id);
      if (i >= 0) next[i] = { ...(next[i] as any), status: ev.isError ? "error" : "ok", preview: ev.preview };
      break;
    }
    case "subagent-step": {
      const i = next.findIndex((x) => x.type === "tool" && x.id === ev.parentToolUseId);
      if (i >= 0) {
        const t = next[i] as Extract<Item, { type: "tool" }>;
        next[i] = { ...t, steps: [...t.steps, ev.summary] };
      }
      break;
    }
    case "permission":
      next.push({ type: "permission", id: ev.id, tool: ev.tool, summary: ev.summary, detail: ev.detail });
      break;
    case "permission-answer": {
      const i = next.findIndex((x) => x.type === "permission" && x.id === ev.id);
      if (i >= 0) next[i] = { ...(next[i] as any), answer: ev.allow };
      break;
    }
    case "result":
      next.push({ type: "result", ok: ev.ok, costUsd: ev.costUsd, durationMs: ev.durationMs, message: ev.message });
      break;
    case "error":
      next.push({ type: "error", message: ev.message });
      break;
    default:
      break;
  }
  return next;
}

const TOOL_ICON: Record<string, string> = {
  Read: "📖",
  Write: "📝",
  Edit: "✏️",
  MultiEdit: "✏️",
  Bash: "⌨️",
  Grep: "🔎",
  Glob: "🗂️",
  WebSearch: "🌐",
  WebFetch: "🌐",
  Agent: "🤝",
  Task: "🤝",
  TodoWrite: "✅",
};

const FALLBACK_MODELS = [
  { value: "", label: "Par défaut" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

export function Chat({
  cwd,
  projectName,
  sessionId,
  onSession,
  onRunning,
}: {
  cwd: string;
  projectName: string;
  sessionId: string | null;
  onSession: (id: string) => void;
  onRunning: (running: boolean) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem("cav-mode") as Mode) || "default";
    } catch {
      return "default";
    }
  });
  const [team, setTeam] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cav-team") !== "0";
    } catch {
      return true;
    }
  });
  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem("cav-model") ?? "";
    } catch {
      return "";
    }
  });
  const usage = useUsage();
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const currentSession = useRef<string | null>(sessionId);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("cav-mode", mode);
    } catch {
      /* ignore */
    }
  }, [mode]);
  useEffect(() => {
    try {
      localStorage.setItem("cav-team", team ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [team]);
  useEffect(() => {
    try {
      localStorage.setItem("cav-model", model);
    } catch {
      /* ignore */
    }
  }, [model]);

  const attach = useCallback(
    (id: string, replace: boolean) => {
      esRef.current?.close();
      setRunId(id);
      onRunning(true);
      if (replace) setItems([]);
      const es = new EventSource(`/api/chat/${id}/stream`);
      esRef.current = es;
      es.onmessage = (msg) => {
        const ev: ChatEvent = JSON.parse(msg.data);
        if (ev.kind === "session") {
          currentSession.current = ev.sessionId;
          onSession(ev.sessionId);
        }
        if (ev.kind === "end") {
          es.close();
          setRunId(null);
          onRunning(false);
          return;
        }
        setItems((cur) => reduce(cur, ev));
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setRunId(null);
          onRunning(false);
        }
      };
    },
    [onRunning, onSession],
  );

  // Charger la conversation (ou repartir de zéro) quand on change de projet ou de conversation
  useEffect(() => {
    if (sessionId && sessionId === currentSession.current && runId) return; // c'est la conversation en cours
    esRef.current?.close();
    setRunId(null);
    onRunning(false);
    currentSession.current = sessionId;
    setError(null);
    if (!sessionId) {
      setItems([]);
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(`/api/history?cwd=${encodeURIComponent(cwd)}&sessionId=${sessionId}`).then((r) => r.json()),
      fetch("/api/chat/active").then((r) => r.json()),
    ])
      .then(([events, active]: [ChatEvent[], { runId: string; sessionId?: string; prompt: string }[]]) => {
        let before = Array.isArray(events) ? events.reduce(reduce, [] as Item[]) : [];
        const live = active.find((a) => a.sessionId === sessionId);
        if (live) {
          // une réponse est en cours : le disque en contient déjà le début, le flux va tout renvoyer
          let cut = -1;
          before.forEach((x, i) => {
            if (x.type === "user" && x.text === live.prompt) cut = i;
          });
          if (cut >= 0) before = before.slice(0, cut);
          setItems(before);
          attach(live.runId, false);
        } else {
          setItems(before);
        }
      })
      .catch(() => setError("Impossible de charger cette conversation."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, sessionId]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  useEffect(() => () => esRef.current?.close(), []);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || runId) return;
    setInput("");
    setError(null);
    stick.current = true;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, prompt, sessionId: currentSession.current, mode, team, model: model || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      attach(d.runId, false);
    } catch (e: any) {
      setError(e.message);
      setInput(prompt);
    }
  };

  const stop = () => {
    if (runId) fetch(`/api/chat/${runId}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  };

  const answer = (id: string, allow: boolean, always = false) => {
    if (!runId) return;
    fetch(`/api/chat/${runId}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, allow, always }),
    });
  };

  const waitingPermission = items.some((x) => x.type === "permission" && x.answer === undefined);
  const last = items[items.length - 1];
  const thinking = !!runId && !waitingPermission && !(last?.type === "text" && last.streaming);

  return (
    <div className="chat">
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="chat-inner">
          {loading && <p className="muted center">Chargement de la conversation…</p>}
          {!loading && items.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-title">Que veux-tu faire dans {projectName} ?</div>
              <div className="suggestions">
                {["Explique-moi comment ce projet est organisé", "Trouve et corrige les bugs évidents", "Lance les tests et dis-moi ce qui échoue", "Propose des améliorations pour le README"].map((s) => (
                  <button key={s} className="suggestion" onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((it, i) => (
            <ItemView key={i} it={it} onAnswer={answer} live={!!runId} />
          ))}
          {thinking && (
            <div className="thinking">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              Claude travaille…
            </div>
          )}
          {error && <div className="msg error-msg">{error}</div>}
        </div>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={runId ? "Claude répond… tu pourras écrire la suite juste après." : `Écris à Claude (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)`}
          rows={3}
          disabled={!!runId}
        />
        <div className="composer-bar">
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} title={MODES.find((m) => m.id === mode)?.hint} aria-label="Mode de permission">
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            className="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!!runId}
            aria-label="Modèle de l'agent principal"
            title="Modèle de l'agent principal (Claude). Les sous-agents de l'équipe gardent chacun le leur."
          >
            {(usage?.models.length ? usage.models : FALLBACK_MODELS).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
            {model && !(usage?.models.length ? usage.models : FALLBACK_MODELS).some((m) => m.value === model) && <option value={model}>{model}</option>}
          </select>
          <label
            className={`team-toggle ${team ? "on" : ""}`}
            title={
              team
                ? "Mode équipe : Claude dirige ses sous-agents spécialisés. Il ne code pas lui-même : le développeur modifie, le testeur lance les commandes, les Haiku ne font que lire et chercher."
                : "Claude travaille seul, avec tous ses outils."
            }
          >
            <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} disabled={!!runId} />
            Mode équipe
          </label>
          <span className="muted small mode-hint">{team ? "Claude dirige l'équipe, chacun sa spécialité" : MODES.find((m) => m.id === mode)?.hint}</span>
          {runId ? (
            <button type="button" className="btn danger" onClick={stop}>
              ■ Arrêter
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={!input.trim()}>
              Envoyer
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ItemView({ it, onAnswer, live }: { it: Item; onAnswer: (id: string, allow: boolean, always?: boolean) => void; live: boolean }) {
  switch (it.type) {
    case "user":
      return <div className="msg user-msg">{it.text}</div>;
    case "text":
      return (
        <div className={`msg claude-msg ${it.streaming ? "streaming" : ""}`}>
          <Markdown text={it.text} />
        </div>
      );
    case "tool":
      return (
        <details className={`tool-card ${it.status}`}>
          <summary>
            <span className="tool-icon">{TOOL_ICON[it.name] ?? "🔧"}</span>
            <span className="tool-summary">{it.summary}</span>
            <span className={`tool-state ${it.status}`}>{it.status === "running" ? (live ? "en cours" : "—") : it.status === "ok" ? "✓" : "échec"}</span>
          </summary>
          {it.steps.length > 0 && (
            <ul className="sub-steps">
              {it.steps.slice(-8).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
              {it.steps.length > 8 && <li className="muted">… et {it.steps.length - 8} étapes avant</li>}
            </ul>
          )}
          {it.detail && <pre className="tool-detail">{it.detail}</pre>}
          {it.preview && <pre className="tool-preview">{it.preview}</pre>}
        </details>
      );
    case "permission":
      return (
        <div className={`permission ${it.answer === undefined ? "pending" : it.answer ? "allowed" : "denied"}`}>
          <div className="perm-title">
            {it.answer === undefined ? "Claude demande la permission" : it.answer ? "Autorisé" : "Refusé"} : <b>{it.summary}</b>
          </div>
          {it.detail && <pre className="tool-detail">{it.detail}</pre>}
          {it.answer === undefined && live && (
            <div className="perm-actions">
              <button className="btn primary" onClick={() => onAnswer(it.id, true)}>
                Autoriser
              </button>
              <button className="btn" onClick={() => onAnswer(it.id, true, true)}>
                Toujours autoriser
              </button>
              <button className="btn" onClick={() => onAnswer(it.id, false)}>
                Refuser
              </button>
            </div>
          )}
        </div>
      );
    case "result":
      return (
        <div className={`result-line ${it.ok ? "" : "bad"}`}>
          {it.ok ? "Terminé" : (it.message ?? "Interrompu")}
          {it.durationMs ? ` · ${Math.round(it.durationMs / 1000)} s` : ""}
          {it.costUsd ? ` · ${it.costUsd.toFixed(2)} $` : ""}
        </div>
      );
    case "error":
      return <div className="msg error-msg">{it.message}</div>;
  }
}
