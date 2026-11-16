# Claude Agents Viewer

Une interface graphique locale pour **voir et compter les agents et sous-agents de Claude Code**, en temps réel.

![Capture](docs/capture.png)

- **Arbre des agents** : l'agent principal, ses sous-agents, et les sous-agents de ces sous-agents, sur autant de niveaux que nécessaire.
- **Compteurs** : agents au total, sous-agents, actifs, terminés, en erreur ou interrompus, profondeur maximale, appels d'outils, répartition par type (`Explore`, `general-purpose`, vos agents perso…).
- **Détail d'un agent** : statut, modèle, durée, tokens, messages, outils utilisés (avec un graphique), consigne reçue.
- **Temps réel** : l'interface se met à jour dès qu'un agent écrit dans son transcript.
- **100 % local** : le serveur n'écoute que sur `127.0.0.1` et lit simplement les fichiers de `~/.claude`. Rien n'est envoyé ailleurs.

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
npm test          # tests du parseur sur les sessions de démo
npm run typecheck
```

Structure :

```
server/   index.ts (API + flux SSE), parser.ts (lecture des transcripts), types.ts
src/      App.tsx (interface React), styles.css
scripts/  make-fixtures.mjs (sessions factices), demo.mjs (démo en direct)
test/     tests du parseur
```

## Licence

MIT
