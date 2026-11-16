// Types partagés entre le serveur et l'interface.

export type AgentStatus = "running" | "done" | "error" | "interrupted";

export interface AgentNode {
  /** "main" pour l'agent principal, sinon l'agentId de Claude Code */
  id: string;
  /** Libellé lisible : description passée à l'outil Agent/Task */
  label: string;
  agentType: string;
  model?: string;
  status: AgentStatus;
  depth: number;
  prompt?: string;
  startedAt?: string;
  lastActivityAt?: string;
  durationMs?: number;
  totalTokens?: number;
  /** Poids relatif dans le quota (voir usageWeight) */
  weight?: number;
  /** Dernier outil appelé (ce qu'il fait en ce moment s'il est actif) */
  lastTool?: string;
  /** Nombre d'appels par outil, ex. { Bash: 3, Read: 5 } */
  tools: Record<string, number>;
  toolCalls: number;
  messages: number;
  children: AgentNode[];
}

export interface AgentCounts {
  total: number;
  subagents: number;
  running: number;
  done: number;
  error: number;
  interrupted: number;
  maxDepth: number;
  toolCalls: number;
  byType: Record<string, number>;
}

export interface SessionSummary {
  id: string;
  project: string;
  projectDir: string;
  /** Dossier de travail réel de la session, s'il est connu */
  cwd?: string;
  title?: string;
  startedAt?: string;
  lastActivityAt?: string;
  counts: AgentCounts;
}

export interface SessionDetail extends SessionSummary {
  root: AgentNode;
}

// ------------------------------------------------------------ équipe

/** utilisateur : ~/.claude/agents · projet : <projet>/.claude/agents · equipe : fournie avec l'appli */
export type DefinitionScope = "utilisateur" | "projet" | "equipe";

export interface AgentDefinition {
  name: string;
  description: string;
  /** haiku, sonnet, opus, inherit… */
  model: string;
  /** Vide = tous les outils (hérités) */
  tools: string[];
  color?: string;
  prompt: string;
  scope: DefinitionScope;
  file: string;
  project?: string;
}

export interface TeamMember extends AgentDefinition {
  installed: "oui" | "modifié" | "non";
}

export interface AgentUsage {
  type: string;
  runs: number;
  running: number;
  errors: number;
  tokens: number;
  toolCalls: number;
  durationMs: number;
  /** Lancements par famille de modèle : { haiku: 3, opus: 1 } */
  models: Record<string, number>;
  sessions: number;
  lastUsedAt?: string;
}

export interface MainUsage {
  sessions: number;
  sessionsWithSubagents: number;
  /** Sessions où l'agent principal a beaucoup lu sans déléguer */
  heavyReaderSessions: number;
  readCalls: number;
  subagentLaunches: number;
}

export interface Tip {
  id: string;
  level: "action" | "economie" | "alerte" | "info";
  title: string;
  text: string;
}

export interface TeamReport {
  definitions: AgentDefinition[];
  team: TeamMember[];
  usage: AgentUsage[];
  main: MainUsage;
  claudeAgentsDir: string;
  tips: Tip[];
  snippet: string;
}

export interface InstallResult {
  dir: string;
  installed: string[];
  updated: string[];
  skipped: string[];
}

// ------------------------------------------------------------ bureau

export interface OfficeTask {
  label: string;
  sessionId: string;
  sessionTitle?: string;
  project: string;
  tool?: string;
  lastActivityAt?: string;
}

export interface OfficeResident {
  /** "principal" pour l'agent principal, sinon le type de sous-agent */
  name: string;
  model: string;
  color?: string;
  /** Rôle en une phrase */
  role: string;
  /** Membre de l'équipe, ou simple visiteur (Explore, general-purpose, agent perso…) */
  kind: "principal" | "equipe" | "visiteur";
  working: boolean;
  tasks: OfficeTask[];
  lastSeenAt?: string;
}

export interface OfficeReport {
  residents: OfficeResident[];
  working: number;
  sleeping: number;
}

// ------------------------------------------------------------ projets & discussion

export interface ProjectInfo {
  path: string;
  name: string;
  /** Ajouté à la main depuis l'interface */
  pinned: boolean;
  lastActivityAt?: string;
  running?: number;
}

export interface DirListing {
  path: string;
  parent?: string;
  home: string;
  isRepo: boolean;
  dirs: { name: string; path: string; isRepo: boolean }[];
}

export interface ConversationInfo {
  sessionId: string;
  title: string;
  lastModified: number;
}

/** Événements simplifiés envoyés à l'interface pendant une discussion. */
export type ChatEvent =
  | { kind: "user"; text: string }
  | { kind: "session"; sessionId: string; model: string; cwd: string }
  | { kind: "text-delta"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; detail?: string }
  | { kind: "tool-result"; id: string; isError: boolean; preview: string }
  | { kind: "subagent-step"; parentToolUseId: string; summary: string; tool: string }
  | { kind: "permission"; id: string; tool: string; summary: string; detail?: string }
  | { kind: "permission-answer"; id: string; allow: boolean }
  | { kind: "result"; ok: boolean; costUsd?: number; durationMs?: number; message?: string }
  | { kind: "error"; message: string }
  | { kind: "end"; sessionId?: string };

// ------------------------------------------------------------ utilisation de Claude

export interface UsageWindow {
  id: string;
  label: string;
  /** Pourcentage utilisé, 0 à 100. */
  percent: number | null;
  resetsAt: string | null;
  blocked: boolean;
}

export interface ModelChoice {
  /** Valeur à passer au SDK ("" = modèle par défaut). */
  value: string;
  label: string;
  model?: string;
}

export interface ClaudeUsage {
  plan: string | null;
  limitsAvailable: boolean;
  windows: UsageWindow[];
  models: ModelChoice[];
  updatedAt: string;
  error?: string;
}
