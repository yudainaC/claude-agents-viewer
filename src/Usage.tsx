import { useEffect, useState } from "react";
import type { ClaudeUsage } from "../server/types.ts";

let shared: ClaudeUsage | null = null;
const subs = new Set<(u: ClaudeUsage) => void>();
let inflight: Promise<void> | null = null;

/** Utilisation de Claude, partagée entre les composants (une seule requête à la fois). */
export function refreshUsage(force = false) {
  inflight ??= fetch(`/api/usage${force ? "?refresh" : ""}`)
    .then((r) => r.json())
    .then((u: ClaudeUsage) => {
      shared = u;
      subs.forEach((f) => f(u));
    })
    .catch(() => {})
    .finally(() => (inflight = null));
  return inflight;
}

export function useUsage(): ClaudeUsage | null {
  const [u, setU] = useState(shared);
  useEffect(() => {
    subs.add(setU);
    if (!shared) refreshUsage();
    return () => {
      subs.delete(setU);
    };
  }, []);
  return u;
}

function until(iso: string | null) {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "bientôt";
  const m = Math.round(ms / 60000);
  if (m < 60) return `dans ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `dans ${h} h ${String(m % 60).padStart(2, "0")}`;
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" });
}

/** Carte « Utilisation » en bas de la barre latérale. */
export function UsageCard({ running }: { running: boolean }) {
  const u = useUsage();

  // rafraîchit toutes les 2 minutes, et à la fin de chaque réponse de Claude
  useEffect(() => {
    const id = setInterval(() => refreshUsage(), 120_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!running) refreshUsage(true);
  }, [running]);

  return (
    <div className="usage-card">
      <div className="side-title">
        Utilisation
        {u?.plan && <span className="usage-plan">{u.plan}</span>}
      </div>
      {!u ? (
        <div className="muted small">Chargement…</div>
      ) : u.windows.length ? (
        u.windows.map((w) => {
          const p = w.percent ?? 0;
          return (
            <div key={w.id} className="usage-row" title={w.resetsAt ? `Se réinitialise ${until(w.resetsAt)}` : undefined}>
              <div className="usage-label">
                <span>{w.label}</span>
                <span className={p >= 90 ? "usage-hot" : ""}>{w.percent == null ? "?" : `${p} %`}</span>
              </div>
              <div className="usage-bar">
                <div className={`usage-fill ${p >= 90 ? "hot" : p >= 70 ? "warm" : ""}`} style={{ width: `${Math.min(100, p)}%` }} />
              </div>
              {w.resetsAt && <div className="usage-reset">{w.blocked ? "Limite atteinte, reprise " : "Remise à zéro "}{until(w.resetsAt)}</div>}
            </div>
          );
        })
      ) : (
        <div className="muted small">
          {u.error ? "Impossible de lire l'utilisation (Claude Code est-il connecté ?)." : u.limitsAvailable ? "Aucune limite en cours." : "Pas de limite d'abonnement : tu paies à l'usage (le coût s'affiche sous chaque réponse)."}
        </div>
      )}
    </div>
  );
}
