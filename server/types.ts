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
  title?: string;
  startedAt?: string;
  lastActivityAt?: string;
  counts: AgentCounts;
}

export interface SessionDetail extends SessionSummary {
  root: AgentNode;
}
