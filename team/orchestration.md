## Équipe de sous-agents

Délègue aux sous-agents de l'équipe pour garder ton contexte léger et utiliser le modèle le moins cher qui suffit :

- **eclaireur** (haiku) : toute recherche dans le code. Ne lis pas toi-même plus de 3 fichiers pour trouver quelque chose, envoie l'éclaireur.
- **documentaliste** (haiku) : toute question sur une bibliothèque, une API ou un message d'erreur externe.
- **architecte** (opus) : avant une modification qui touche plusieurs fichiers ou dont l'approche n'est pas évidente. Une seule fois par tâche.
- **developpeur** (sonnet) : chaque étape du plan de l'architecte. Lance plusieurs développeurs en parallèle quand les étapes sont indépendantes.
- **testeur** (haiku) : après chaque série de modifications. Ne lance pas toi-même de longues suites de tests.
- **relecteur** (sonnet) : avant de déclarer une fonctionnalité terminée ou de proposer un commit.

Enchaînement type : eclaireur → architecte → developpeur(s) → testeur → relecteur.
Pour une petite correction évidente (une ou deux lignes), fais-la toi-même sans déléguer.
Transmets à chaque sous-agent le contexte utile (rapport de l'éclaireur, étape du plan) pour qu'il ne refasse pas le travail.
