import { useEffect, useState } from "react";
import type { AgentNode, SessionDetail } from "../server/types.ts";
import { agentColor } from "./colors.ts";
import { World, type Actor } from "./World.tsx";

const ACTION: Record<string, string> = {
  Read: "lit un fichier",
  Grep: "cherche dans le code",
  Glob: "parcourt les dossiers",
  Edit: "modifie le code",
  Write: "écrit un fichier",
  Bash: "lance une commande",
  WebSearch: "cherche sur le web",
  WebFetch: "lit une page web",
  Agent: "attend un sous-agent",
  Task: "attend un sous-agent",
  TodoWrite: "organise ses tâches",
};

const TEAM = ["eclaireur", "documentaliste", "architecte", "developpeur", "testeur", "relecteur"];

const STATUS: Record<AgentNode["status"], string> = {
  running: "au travail",
  done: "a terminé",
  error: "a échoué",
  interrupted: "interrompu",
};

/** Panneau de droite : les agents de la conversation, en direct et sans jargon. */
export function AgentsPanel({ sessionId, version, running, onOpenOffice }: { sessionId: string | null; version: number; running: boolean; onOpenOffice?: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  useEffect(() => {
    if (!sessionId) return setDetail(null);
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .catch(() => {});
  }, [sessionId, version, running]);

  const flat: AgentNode[] = [];
  const walk = (n: AgentNode) => {
    flat.push(n);
    n.children.forEach(walk);
  };
  if (detail) walk(detail.root);
  const subs = flat.filter((n) => n.depth > 0);
  const active = subs.filter((n) => n.status === "running").length;
  const mainBusy = running || detail?.root.status === "running";
  // même studio que l'onglet Bureau : toute l'équipe est là, endormie, et se
  // réveille quand Claude lui confie une tâche dans cette conversation
  const runningOf = (type: string) => subs.filter((n) => n.agentType === type && n.status === "running").pop();
  const lastOf = (type: string) => subs.filter((n) => n.agentType === type).pop();
  const actors: Actor[] = [
    { id: "principal", name: "Claude", color: agentColor("principal"), working: !!mainBusy, tool: detail?.root.lastTool, label: "L'agent principal" },
    ...TEAM.map((type) => {
      const r = runningOf(type);
      const l = lastOf(type);
      return { id: `team-${type}`, name: type, color: agentColor(type), working: !!r, tool: r?.lastTool, label: r?.label ?? l?.label };
    }),
    // sous-agents hors équipe (Explore, general-purpose…) : des visiteurs
    ...subs
      .filter((n) => !TEAM.includes(n.agentType))
      .slice(-4)
      .map((n) => ({ id: n.id, name: n.agentType, color: agentColor(n.agentType), working: n.status === "running", tool: n.lastTool, label: n.label, visitor: true })),
  ];


  return (
    <aside className="agents-panel">
      <div className="preview-wrap">
        <World key={sessionId ?? "new"} actors={actors} compact />
        {onOpenOffice && (
          <button className="preview-open" onClick={onOpenOffice} title="Ouvrir le bureau en grand">
            ⤢ Agrandir
          </button>
        )}
      </div>
      <h2>Agents</h2>
      {!detail ? (
        <p className="muted small">Les agents de la conversation apparaîtront ici dès que Claude commencera à travailler.</p>
      ) : (
        <>
          <p className="agents-summary">
            {subs.length === 0
              ? "Claude travaille seul pour l'instant."
              : `${subs.length} sous-agent${subs.length > 1 ? "s" : ""} dans cette conversation${active ? `, dont ${active} au travail` : ""}.`}
          </p>
          <ul className="agent-list">
            {flat.map((n) => (
              <li key={n.id} className={`agent-row ${n.status}`} style={{ paddingLeft: 10 + n.depth * 16 }}>
                <span className={`status-dot ${n.status === "running" || (n.depth === 0 && running) ? "running" : n.status}`} />
                <div className="agent-text">
                  <div className="agent-name">{n.depth === 0 ? "Claude (principal)" : n.label}</div>
                  <div className="agent-doing">
                    {n.depth > 0 && <span className="agent-type">{n.agentType}</span>}
                    {(n.status === "running" || (n.depth === 0 && running)) && n.lastTool ? (ACTION[n.lastTool] ?? n.lastTool) : n.depth === 0 && !running ? "en attente de ton message" : STATUS[n.status]}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
