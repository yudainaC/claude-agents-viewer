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
