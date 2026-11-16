# Claude Agents Viewer

Une interface graphique locale pour **voir et compter les agents et sous-agents de Claude Code**, en temps réel.

![Capture](docs/capture.png)

- **Arbre des agents** : l'agent principal, ses sous-agents, et les sous-agents de ces sous-agents, sur autant de niveaux que nécessaire.
- **Compteurs** : agents au total, sous-agents, actifs, terminés, en erreur ou interrompus, profondeur maximale, appels d'outils, répartition par type (`Explore`, `general-purpose`, vos agents perso…).
- **Détail d'un agent** : statut, modèle, durée, tokens, messages, outils utilisés (avec un graphique), consigne reçue.
- **Temps réel** : l'interface se met à jour dès qu'un agent écrit dans son transcript.
- **100 % local** : le serveur n'écoute que sur `127.0.0.1` et lit simplement les fichiers de `~/.claude`. Rien n'est envoyé ailleurs.

## L'équipe de sous-agents

![Onglet Équipe](docs/equipe.png)

L'appli fournit une équipe de six sous-agents Claude Code (dans `.claude/agents/`), pensée pour **dépenser moins** : l'agent principal, le plus cher, garde un contexte léger et délègue chaque tâche au modèle le moins cher qui suffit.

| Sous-agent       | Modèle | Outils                         | Rôle |
|------------------|--------|--------------------------------|------|
| `eclaireur`      | Haiku  | Read, Grep, Glob               | Trouve où est le code et rend un rapport court (`fichier:ligne`) |
| `documentaliste` | Haiku  | WebSearch, WebFetch, lecture   | Cherche dans la doc et sur le web, avec les sources |
| `architecte`     | Opus   | Read, Grep, Glob               | Conçoit le plan d'une modification non triviale, une seule fois |
| `developpeur`    | Sonnet | Read, Edit, Write, Bash…       | Réalise une étape précise du plan et la vérifie |
| `testeur`        | Haiku  | Bash, lecture                  | Lance les tests et ne rend que les échecs, sans les longs journaux |
| `relecteur`      | Sonnet | lecture, git diff              | Relit le diff et signale les vrais bugs |

Enchaînement type : **eclaireur → architecte → developpeur(s) → testeur → relecteur**. Les agents de lecture n'ont pas le droit de modifier de fichiers.

**Installer l'équipe** (dans `~/.claude/agents`, pour tous tes projets) :

- depuis l'onglet **Équipe** de l'interface, bouton « Installer l'équipe » ;
- ou en ligne de commande : `npm run install-team` (ajoute `-- --force` pour écraser une version que tu as modifiée).

Ensuite, colle le guide `team/orchestration.md` dans ton `~/.claude/CLAUDE.md` : il dit à Claude quand déléguer à qui. L'onglet Équipe a un bouton pour le copier.

L'onglet Équipe montre aussi l'usage réel de chaque type de sous-agent (lancements, modèles, tokens, erreurs) et des **conseils d'optimisation** tirés de tes sessions, par exemple :

- un agent qui ne fait que lire mais tourne sur Opus ou Sonnet ;
- l'agent principal qui fait 25 lectures ou plus sans rien déléguer ;
- une majorité de sous-agents `general-purpose` au lieu d'agents spécialisés ;
- un type de sous-agent qui échoue souvent.

## Démarrage

Il faut Node.js 20 ou plus récent.

```bash
npm install

# Essayer avec des sessions factices qui bougent toutes seules
npm run demo

# Utiliser vos vraies sessions Claude Code (~/.claude/projects)
npm run dev
```

Puis ouvrez http://127.0.0.1:4317 et lancez Claude Code dans un autre terminal.

Pour une version compilée : `npm run build` puis `npm start`.

### Options

| Variable     | Par défaut   | Rôle                                      |
|--------------|--------------|-------------------------------------------|
| `CLAUDE_DIR` | `~/.claude`  | Dossier de configuration de Claude Code   |
| `PORT`       | `4317`       | Port du serveur                           |
| `HOST`       | `127.0.0.1`  | Adresse d'écoute (gardez-la locale)        |

## Comment ça marche

Claude Code écrit chaque session dans `~/.claude/projects/<projet>/<session>.jsonl`.
Chaque sous-agent a son propre transcript :

```
<session>/subagents/agent-<id>.jsonl
<session>/subagents/agent-<id>.meta.json   { agentType, description, toolUseId, finished, … }
```

Le serveur (`server/parser.ts`) relie chaque sous-agent à son parent en cherchant l'appel d'outil `Agent` (ou `Task`, ancien nom) dont l'identifiant vaut `toolUseId`. C'est ce qui permet de reconstruire l'arbre sur plusieurs niveaux.

Un agent est **actif** s'il n'est pas marqué terminé et a écrit dans les 2 dernières minutes, ou s'il attend un sous-agent actif. Un agent non terminé et silencieux depuis plus longtemps est **interrompu**.

## Développement

```bash
npm test          # tests du parseur et de l'équipe sur les sessions de démo
npm run typecheck
```

Structure :

```
server/   index.ts (API + flux SSE), parser.ts (lecture des transcripts), types.ts
src/      App.tsx (interface React), styles.css
server/   team.ts (équipe : définitions, installation, usage, conseils)
src/      Team.tsx (onglet Équipe)
.claude/agents/  l'équipe de sous-agents
team/     orchestration.md (guide à coller dans CLAUDE.md)
scripts/  make-fixtures.mjs (sessions factices), demo.mjs (démo en direct), install-team.ts
test/     tests du parseur et de l'équipe
```

## Licence

MIT
