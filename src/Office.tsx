import { useEffect, useState } from "react";
import type { OfficeReport, OfficeResident } from "../server/types.ts";
import { agentColor } from "./colors.ts";
import { World } from "./World.tsx";

// Ordre des chambres : le chef, puis l'équipe dans l'ordre de l'enchaînement.
const ORDER = ["principal", "eclaireur", "documentaliste", "architecte", "developpeur", "testeur", "relecteur"];

const COLORS: Record<string, string> = {
  cyan: "#3fb6c6",
  blue: "#5b84d6",
  purple: "#9b6fd3",
  green: "#4caf7a",
  yellow: "#d9a93a",
  red: "#d9604f",
  orange: "#d97757",
  pink: "#d76a9e",
};

const MODEL_LABEL: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", inherit: "Modèle principal" };

const TOOL_VERB: Record<string, string> = {
  Read: "lit un fichier",
  Grep: "cherche",
  Glob: "parcourt les dossiers",
  Edit: "modifie le code",
  Write: "écrit un fichier",
  Bash: "lance une commande",
  WebSearch: "cherche sur le web",
  WebFetch: "lit une page web",
  Agent: "délègue",
  Task: "délègue",
  TodoWrite: "met à jour sa liste",
};

function ago(ts?: string) {
  if (!ts) return "jamais vu";
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function colorOf(r: OfficeResident) {
  if (r.kind === "principal") return COLORS.orange;
  if (r.color && COLORS[r.color]) return COLORS[r.color];
  const pool = Object.values(COLORS);
  return pool[hash(r.name) % pool.length];
}

function displayName(r: OfficeResident) {
  return r.kind === "principal" ? "Agent principal" : r.name;
}

export function OfficeView({ version, onOpenSession }: { version: number; onOpenSession: (id: string) => void }) {
  const [report, setReport] = useState<OfficeReport | null>(null);

  useEffect(() => {
    fetch("/api/office")
      .then((r) => r.json())
      .then(setReport)
      .catch(() => {});
  }, [version]);

  if (!report) return <div className="placeholder">Chargement du bureau…</div>;

  const rank = (r: OfficeResident) => {
    const i = ORDER.indexOf(r.name);
    return i === -1 ? 100 + (r.kind === "equipe" ? 0 : 50) : i;
  };
  const residents = [...report.residents].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return (
    <div className="office">
      <header className="head office-head">
        <div>
          <h1>Le bureau</h1>
          <div className="sub">Les agents dorment dans le coin repos et filent à leur bureau dès qu'on leur confie une tâche. La pièce s'éclaire quand quelqu'un travaille. Clique sur un agent au travail pour voir sa conversation.</div>
        </div>
        <div className="office-count">
          <span className="oc working">
            <b>{report.working}</b> au travail
          </span>
          <span className="oc sleeping">
            <b>{report.sleeping}</b> endormi{report.sleeping > 1 ? "s" : ""}
          </span>
        </div>
      </header>

      <World
        actors={residents.map((r) => ({
          id: r.name,
          name: displayName(r),
          color: agentColor(r.name, r.color),
          working: r.working,
          tool: r.tasks[0]?.tool,
          label: r.working ? r.tasks[0]?.label : r.role,
          visitor: r.kind === "visiteur",
        }))}
        onPick={(a) => {
          const r = residents.find((x) => x.name === a.id);
          if (r?.tasks[0]) onOpenSession(r.tasks[0].sessionId);
        }}
      />

      <h2 className="section-title office-sub">Les chambres</h2>
      <div className="rooms">
        {residents.map((r) => (
          <RoomCard key={r.name} r={r} onOpenSession={onOpenSession} />
        ))}
      </div>
    </div>
  );
}

function RoomCard({ r, onOpenSession }: { r: OfficeResident; onOpenSession: (id: string) => void }) {
  const task = r.tasks[0];
  const color = colorOf(r);
  return (
    <article className={`room ${r.working ? "is-working" : "is-sleeping"} ${r.kind}`}>
      <Room working={r.working} color={color} tool={task?.tool} seed={hash(r.name)} />
      <div className="room-info">
        <div className="room-top">
          <span className="room-name">{displayName(r)}</span>
          {r.kind === "visiteur" && <span className="visitor">visiteur</span>}
          <span className="room-model">{MODEL_LABEL[r.model] ?? r.model}</span>
        </div>
        {r.working ? (
          <>
            <div className="room-status working">
              <span className="status-dot running" /> Au travail{task?.tool ? ` · ${TOOL_VERB[task.tool] ?? task.tool}` : ""}
              {r.tasks.length > 1 && <span className="multi"> · {r.tasks.length} tâches</span>}
            </div>
            {r.tasks.slice(0, 2).map((t, i) => (
              <button key={i} className="room-task" onClick={() => onOpenSession(t.sessionId)} title="Voir la session">
                {t.label}
                <span className="room-task-project">{t.project.split("/").filter(Boolean).pop()}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="room-status sleeping">Dort · vu {ago(r.lastSeenAt)}</div>
            <div className="room-role">{r.role}</div>
          </>
        )}
      </div>
    </article>
  );
}

/** La chambre dessinée : un lit à gauche, un bureau et un ordinateur à droite. */
function Room({ working, color, tool, seed }: { working: boolean; color: string; tool?: string; seed: number }) {
  const delay = `${-(seed % 17) / 10}s`;
  return (
    <svg className="room-svg" viewBox="0 0 240 150" role="img" aria-label={working ? "Au travail devant son ordinateur" : "Endormi dans son lit"}>
      {/* mur et sol */}
      <rect className="wall" x="0" y="0" width="240" height="104" />
      <rect className="floor" x="0" y="104" width="240" height="46" />
      <rect className="baseboard" x="0" y="102" width="240" height="3" />

      {/* fenêtre : nuit étoilée quand il dort */}
      <g transform="translate(18 16)">
        <rect className="window-frame" x="0" y="0" width="48" height="38" rx="3" />
        <rect className={working ? "sky-day" : "sky-night"} x="3" y="3" width="42" height="32" rx="1.5" />
        {working ? (
          <circle cx="34" cy="13" r="5" className="sun" />
        ) : (
          <>
            <path d="M33 9 a6 6 0 1 0 6 8 a5 5 0 1 1 -6 -8z" className="moon" />
            <circle cx="10" cy="10" r="0.9" className="star" />
            <circle cx="18" cy="24" r="0.7" className="star" />
            <circle cx="26" cy="8" r="0.6" className="star" />
          </>
        )}
        <rect className="window-frame" x="22.5" y="3" width="3" height="32" />
      </g>

      {/* cadre au mur */}
      <rect x="84" y="24" width="18" height="14" rx="1.5" className="frame" />
      <path d="M86 35 l4-5 3 3 3-4 4 6z" fill={color} opacity=".7" />

      {/* lit */}
      <rect x="8" y="76" width="9" height="46" rx="2" className="wood" />
      <rect x="12" y="98" width="92" height="16" rx="3" className="wood" />
      <rect x="14" y="114" width="5" height="10" className="wood-dark" />
      <rect x="96" y="114" width="5" height="10" className="wood-dark" />
      <rect x="16" y="92" width="86" height="9" rx="3" className="mattress" />
      <ellipse cx="32" cy="90" rx="13" ry="6" className="pillow" />

      {working ? (
        // lit vide, couverture repliée
        <rect x="54" y="87" width="46" height="12" rx="5" fill={color} opacity=".85" />
      ) : (
        <g className="sleeper" style={{ animationDelay: delay }}>
          <Critter x={22} y={74} size={20} color="var(--critter)" sleeping />
          <path d="M40 84 q30 -10 62 0 v13 h-62z" fill={color} />
          <path d="M40 84 q30 -10 62 0" stroke="rgb(255 255 255 / .35)" strokeWidth="1.5" fill="none" />
          <g className="zzz" style={{ animationDelay: delay }}>
            <text x="44" y="66">z</text>
            <text x="52" y="56" className="z2">z</text>
            <text x="61" y="45" className="z3">Z</text>
          </g>
        </g>
      )}

      {/* bureau */}
      <rect x="132" y="94" width="96" height="6" rx="1.5" className="wood" />
      <rect x="136" y="100" width="5" height="26" className="wood-dark" />
      <rect x="219" y="100" width="5" height="26" className="wood-dark" />
      {/* ordinateur */}
      <rect x="181" y="86" width="12" height="8" className="metal" />
      <rect x="172" y="92" width="30" height="3" rx="1" className="metal" />
      <rect x="160" y="54" width="54" height="34" rx="3" className="monitor" />
      <rect x="163" y="57" width="48" height="28" rx="1.5" className={working ? "screen on" : "screen"} />
      {working && (
        <g className="code" style={{ animationDelay: delay }}>
          <rect x="166" y="61" width="22" height="2" rx="1" />
          <rect x="170" y="66" width="30" height="2" rx="1" />
          <rect x="170" y="71" width="16" height="2" rx="1" />
          <rect x="166" y="76" width="26" height="2" rx="1" />
          <rect className="cursor" x="194" y="76" width="3" height="3" />
        </g>
      )}
      {!working && <circle cx="208" cy="83" r="1" className="standby" />}
      {/* clavier */}
      <rect x="166" y="91" width="22" height="3" rx="1" className={working ? "keyboard on" : "keyboard"} />
      {/* lampe */}
      <rect x="216" y="80" width="2" height="14" className="metal" />
      <path d="M210 80 h14 l-3 -8 h-8z" fill={color} />
      {working && <path d="M211 81 l-8 13 h28 l-8 -13z" className="lamp-light" />}

      {/* chaise */}
      <rect x="138" y="104" width="26" height="5" rx="2" fill={color} />
      <rect x="135" y="80" width="5" height="29" rx="2" fill={color} />
      <rect x="149" y="109" width="3" height="16" className="metal" />
      <rect x="142" y="124" width="18" height="2" rx="1" className="metal" />

      {working && (
        <g className="worker" style={{ animationDelay: delay }}>
          <Critter x={140} y={82} size={22} color="var(--critter)" facing="right" />
          <g className="arms" style={{ animationDelay: delay }}>
            <rect x="157" y="92.5" width="13" height="2.6" rx="1.3" fill="var(--critter)" className="arm a1" />
            <rect x="155" y="95" width="13" height="2.6" rx="1.3" fill="var(--critter)" className="arm a2" />
          </g>
        </g>
      )}

      {working && tool && (
        <g className="bubble">
          <rect x="118" y="12" width={Math.max(46, tool.length * 6.4 + 22)} height="20" rx="10" className="bubble-bg" />
          <path d="M140 31 l6 0 -4 7z" className="bubble-bg" />
          <text x="129" y="26" className="bubble-text">
            {tool}…
          </text>
        </g>
      )}
    </svg>
  );
}

/** Notre petit personnage : une bouille orange avec une étincelle sur la tête. */
function Critter({
  x,
  y,
  size,
  color,
  sleeping,
  facing,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  sleeping?: boolean;
  facing?: "right";
}) {
  const s = size / 20;
  const eyeShift = facing === "right" ? 2.5 : 0;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="critter">
      {/* étincelle */}
      <g transform="translate(10 -1)" className="spark">
        {[0, 45, 90, 135].map((a) => (
          <rect key={a} x="-0.8" y="-3.6" width="1.6" height="7.2" rx="0.8" fill={color} transform={`rotate(${a})`} />
        ))}
      </g>
      <rect x="0" y="2" width="20" height="18" rx="8" fill={color} />
      {sleeping ? (
        <>
          <path d="M5 11 q2 1.8 4 0" stroke="#2a1d17" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M11 11 q2 1.8 4 0" stroke="#2a1d17" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <ellipse cx="4" cy="14.5" rx="1.8" ry="1" fill="#f3a48a" opacity=".8" />
          <ellipse cx="16" cy="14.5" rx="1.8" ry="1" fill="#f3a48a" opacity=".8" />
        </>
      ) : (
        <>
          <g className="eyes">
            <rect x={6 + eyeShift} y="8" width="2.2" height="4" rx="1.1" fill="#2a1d17" />
            <rect x={12 + eyeShift} y="8" width="2.2" height="4" rx="1.1" fill="#2a1d17" />
          </g>
          <path d={`M${8.5 + eyeShift} 14.5 q1.5 1.2 3 0`} stroke="#2a1d17" strokeWidth="1" fill="none" strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

/** Le studio en version décorative (écran d'accueil). */
export function StudioHero({ version }: { version: number }) {
  const [report, setReport] = useState<OfficeReport | null>(null);
  useEffect(() => {
    fetch("/api/office")
      .then((r) => r.json())
      .then(setReport)
      .catch(() => {});
  }, [version]);
  if (!report) return <div className="world hero-placeholder" style={{ aspectRatio: "800 / 560" }} />;
  return (
    <World
      actors={report.residents.map((r) => ({
        id: r.name,
        name: displayName(r),
        color: agentColor(r.name, r.color),
        working: r.working,
        tool: r.tasks[0]?.tool,
        label: r.working ? r.tasks[0]?.label : r.role,
      }))}
    />
  );
}
