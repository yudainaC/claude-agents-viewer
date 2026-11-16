import { useCallback, useEffect, useState } from "react";
import type { AgentUsage, InstallResult, TeamMember, TeamReport, Tip } from "../server/types.ts";

const WORKFLOW = ["eclaireur", "architecte", "developpeur", "testeur", "relecteur"];

const MODEL_COST: Record<string, { label: string; tier: number }> = {
  haiku: { label: "Haiku", tier: 1 },
  sonnet: { label: "Sonnet", tier: 2 },
  opus: { label: "Opus", tier: 3 },
  inherit: { label: "Hérité", tier: 0 },
};

const TIP_LABEL: Record<Tip["level"], string> = {
  action: "À faire",
  economie: "Économie",
  alerte: "Attention",
  info: "Info",
};

function compact(n: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function ago(ts?: string) {
  if (!ts) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function firstSentence(t: string) {
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : t;
}

function ModelBadge({ model }: { model: string }) {
  const c = MODEL_COST[model] ?? { label: model, tier: 0 };
  return (
    <span className={`model-badge tier-${c.tier}`} title={c.tier ? `Coût relatif : ${"€".repeat(c.tier)}` : "Même modèle que l'agent principal"}>
      {c.label}
      {c.tier > 0 && <span className="cost">{"€".repeat(c.tier)}</span>}
    </span>
  );
}

export function TeamView({ version }: { version: number }) {
  const [report, setReport] = useState<TeamReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        setReport(d);
        setError(null);
      })
      .catch(() => setError("Impossible de lire l'équipe."));
  }, []);

  useEffect(load, [load, version]);

  const install = async (overwrite: boolean) => {
    setBusy(true);
    try {
      const r = await fetch("/api/team/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overwrite }),
      });
      if (!r.ok) throw new Error();
      setResult(await r.json());
      load();
    } catch {
      setError("L'installation a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible */
    }
  };

  if (error && !report) return <div className="placeholder">{error}</div>;
  if (!report) return <div className="placeholder">Chargement…</div>;

  const usageOf = new Map(report.usage.map((u) => [u.type, u]));
  const byName = new Map(report.team.map((m) => [m.name, m]));
  const flow = WORKFLOW.map((n) => byName.get(n)).filter(Boolean) as TeamMember[];
  const others = report.team.filter((m) => !WORKFLOW.includes(m.name));
  const missing = report.team.filter((m) => m.installed === "non").length;
  const modified = report.team.filter((m) => m.installed === "modifié").length;
  const extraDefs = report.definitions.filter((d) => !byName.has(d.name));

  return (
    <div className="team">
      <header className="head">
        <h1>Équipe de sous-agents</h1>
        <div className="sub">
          Six spécialistes, chacun sur le modèle le moins cher qui suffit. L'agent principal garde un contexte léger et délègue le reste.
        </div>
      </header>

      <section className="install-bar panel">
        <div>
          <div className="install-title">
            {missing === 0 && modified === 0
              ? "Équipe installée"
              : missing === report.team.length
                ? "Équipe non installée"
                : `${report.team.length - missing} sur ${report.team.length} installés`}
          </div>
          <div className="muted mono">{report.claudeAgentsDir}</div>
        </div>
        <div className="install-actions">
          {(missing > 0 || modified === 0) && (
            <button className={`btn ${missing > 0 ? "primary" : ""}`} disabled={busy || missing === 0} onClick={() => install(false)}>
              {missing === 0 ? "Tout est installé" : `Installer ${missing === report.team.length ? "l'équipe" : `les ${missing} manquants`}`}
            </button>
          )}
          {modified > 0 && (
            <button className="btn" disabled={busy} onClick={() => install(true)}>
              Réinstaller en écrasant ({modified} modifié{modified > 1 ? "s" : ""})
            </button>
          )}
        </div>
        {result && (
          <div className="install-result">
            {result.installed.length > 0 && <>Installés : {result.installed.join(", ")}. </>}
            {result.updated.length > 0 && <>Mis à jour : {result.updated.join(", ")}. </>}
            {result.installed.length + result.updated.length === 0 && <>Rien à changer. </>}
            Claude Code les verra dans les nouvelles sessions (ou après <code>/agents</code>).
          </div>
        )}
      </section>

      <section className="tips">
        {report.tips.map((t) => (
          <div key={t.id} className={`tip ${t.level}`}>
            <span className="tip-level">{TIP_LABEL[t.level]}</span>
            <div>
              <div className="tip-title">{t.title}</div>
              <div className="tip-text">{t.text}</div>
            </div>
          </div>
        ))}
      </section>

      <h2 className="section-title">Enchaînement</h2>
      <div className="flow">
        {flow.map((m, i) => (
          <div className="flow-step" key={m.name}>
            <MemberCard m={m} usage={usageOf.get(m.name)} />
            {i < flow.length - 1 && <span className="flow-arrow" aria-hidden>→</span>}
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <>
          <h2 className="section-title">Au besoin</h2>
          <div className="flow">
            {others.map((m) => (
              <div className="flow-step" key={m.name}>
                <MemberCard m={m} usage={usageOf.get(m.name)} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="split team-split">
        <section className="panel">
          <h2>Usage par type de sous-agent</h2>
          <UsageTable usage={report.usage} />
          <p className="muted small">
            Sur {report.main.sessions} session{report.main.sessions > 1 ? "s" : ""} récentes, {report.main.sessionsWithSubagents} ont utilisé des sous-agents (
            {report.main.subagentLaunches} lancements au total).
          </p>
        </section>

        <section className="panel">
          <h2>Guide pour ton CLAUDE.md</h2>
          <p className="muted small">
            Colle ce texte dans <code>~/.claude/CLAUDE.md</code> (pour tous tes projets) ou dans le <code>CLAUDE.md</code> d'un projet : il dit à
            Claude quand déléguer à qui.
          </p>
          <button className="btn" onClick={copy}>
            {copied ? "Copié ✓" : "Copier le guide"}
          </button>
          <pre className="prompt snippet">{report.snippet}</pre>
        </section>
      </div>

      {extraDefs.length > 0 && (
        <section className="panel" style={{ marginTop: 14 }}>
          <h2>Tes autres sous-agents</h2>
          <ul className="defs">
            {extraDefs.map((d) => (
              <li key={d.file}>
                <span className="mono">{d.name}</span> <ModelBadge model={d.model} />
                <span className="muted small"> {d.scope === "projet" ? d.project : "utilisateur"}</span>
                <div className="muted small">{firstSentence(d.description)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MemberCard({ m, usage }: { m: TeamMember; usage?: AgentUsage }) {
  return (
    <article className={`member ${m.installed === "non" ? "missing" : ""}`}>
      <header>
        <span className="member-name mono">{m.name}</span>
        <ModelBadge model={m.model} />
      </header>
      <p className="member-role">{firstSentence(m.description)}</p>
      <div className="member-tools">
        {m.tools.map((t) => (
          <span key={t} className="tool">
            {t}
          </span>
        ))}
      </div>
      <footer>
        <span className={`inst ${m.installed}`}>
          {m.installed === "oui" ? "Installé" : m.installed === "modifié" ? "Personnalisé" : "Non installé"}
        </span>
        <span className="muted">{usage ? `${usage.runs} lancement${usage.runs > 1 ? "s" : ""}` : "jamais lancé"}</span>
      </footer>
      <details>
        <summary>Consigne</summary>
        <pre className="prompt">{m.prompt}</pre>
      </details>
    </article>
  );
}

function UsageTable({ usage }: { usage: AgentUsage[] }) {
  if (usage.length === 0) return <p className="muted">Aucun sous-agent lancé pour l'instant.</p>;
  return (
    <div className="table-wrap">
      <table className="usage">
        <thead>
          <tr>
            <th>Type</th>
            <th>Lancements</th>
            <th>Modèles</th>
            <th>Tokens</th>
            <th>Outils</th>
            <th>Erreurs</th>
            <th>Dernier</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.type}>
              <td className="mono">{u.type}</td>
              <td>
                {u.runs}
                {u.running > 0 && <span className="live"> · {u.running} actif{u.running > 1 ? "s" : ""}</span>}
              </td>
              <td className="models">
                {Object.entries(u.models)
                  .sort((a, b) => b[1] - a[1])
                  .map(([m, n]) => (
                    <span key={m} className="model-count">
                      {m} {n}
                    </span>
                  ))}
              </td>
              <td>{u.tokens ? compact(u.tokens) : "—"}</td>
              <td>{u.toolCalls}</td>
              <td className={u.errors ? "err" : ""}>{u.errors || "—"}</td>
              <td className="muted">{ago(u.lastUsedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
