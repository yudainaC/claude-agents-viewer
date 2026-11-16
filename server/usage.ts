// Utilisation de Claude : limites de l'abonnement (fenêtre de 5 h, semaine…),
// formule, et modèles disponibles. Les mêmes chiffres que la commande /usage
// de Claude Code, obtenus via le SDK sans envoyer de message (donc gratuit).

import os from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeUsage, ModelChoice, UsageWindow } from "./types.ts";

let cache: { at: number; data: ClaudeUsage } | null = null;
let pending: Promise<ClaudeUsage> | null = null;
const TTL = 60_000;

/** Dernière info de limite reçue pendant une discussion (plus fraîche que le cache). */
const live = new Map<string, UsageWindow>();

const LABELS: Record<string, string> = {
  five_hour: "Session (5 h)",
  seven_day: "Semaine",
  seven_day_opus: "Semaine · Opus",
  seven_day_sonnet: "Semaine · Sonnet",
};

export function noteRateLimit(info: { rateLimitType?: string; utilization?: number; resetsAt?: number; status?: string }) {
  if (!info.rateLimitType || !LABELS[info.rateLimitType]) return;
  live.set(info.rateLimitType, {
    id: info.rateLimitType,
    label: LABELS[info.rateLimitType],
    percent: info.utilization != null ? Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization) : null,
    resetsAt: info.resetsAt ? new Date(info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1)).toISOString() : null,
    blocked: info.status === "rejected",
  });
}

async function* never(): AsyncGenerator<never> {
  await new Promise(() => {});
}

function planLabel(sub: string | null | undefined): string | null {
  if (!sub) return null;
  const s = sub.toLowerCase();
  if (s.includes("max")) return "Claude Max";
  if (s.includes("pro")) return "Claude Pro";
  if (s.includes("team")) return "Claude Team";
  if (s.includes("enterprise")) return "Claude Enterprise";
  if (s.includes("api")) return "Clé API";
  return sub;
}

async function fetchUsage(): Promise<ClaudeUsage> {
  const q = query({ prompt: never() as any, options: { cwd: os.homedir(), settingSources: ["user"] } });
  try {
    const [u, models, account] = await Promise.all([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }).catch(() => null),
      q.supportedModels().catch(() => []),
      q.accountInfo().catch(() => null),
    ]);
    const windows: UsageWindow[] = [];
    const rl: Record<string, { utilization: number | null; resets_at: string | null } | null | undefined> = (u?.rate_limits as any) ?? {};
    for (const id of Object.keys(LABELS)) {
      const w = rl[id];
      if (!w) continue;
      windows.push({ id, label: LABELS[id], percent: w.utilization != null ? Math.round(w.utilization) : null, resetsAt: w.resets_at, blocked: (w.utilization ?? 0) >= 100 });
    }
    // seuls les alias (opus, sonnet…) : la liste complète des versions n'intéresse personne
    const choices: ModelChoice[] = models
      .filter((m) => !m.value.startsWith("claude-"))
      .map((m) => ({ value: m.value === "default" ? "" : m.value, label: m.value === "default" ? `Par défaut (${m.displayName.replace(/default|\(recommended\)/gi, "").trim() || shortName(m.resolvedModel)})` : m.displayName, model: m.resolvedModel }));
    return {
      plan: planLabel(u?.subscription_type ?? account?.subscriptionType),
      limitsAvailable: !!u?.rate_limits_available,
      windows,
      models: choices,
      updatedAt: new Date().toISOString(),
    };
  } finally {
    q.close();
  }
}

function shortName(id?: string) {
  if (!id) return "recommandé";
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ""}` : id;
}

export async function claudeUsage(refresh = false): Promise<ClaudeUsage> {
  if (!refresh && cache && Date.now() - cache.at < TTL) return merge(cache.data);
  pending ??= fetchUsage()
    .then((data) => {
      cache = { at: Date.now(), data };
      live.clear();
      return data;
    })
    .finally(() => (pending = null));
  try {
    return merge(await pending);
  } catch (e: any) {
    if (cache) return merge(cache.data);
    return { plan: null, limitsAvailable: false, windows: [], models: [], updatedAt: new Date().toISOString(), error: e?.message ?? String(e) };
  }
}

function merge(d: ClaudeUsage): ClaudeUsage {
  if (!live.size) return d;
  const windows = d.windows.map((w) => live.get(w.id) ?? w);
  for (const w of live.values()) if (!windows.some((x) => x.id === w.id)) windows.push(w);
  return { ...d, windows, limitsAvailable: d.limitsAvailable || windows.length > 0 };
}
