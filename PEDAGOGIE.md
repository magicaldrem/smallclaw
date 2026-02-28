# Guide Pédagogique SmallClaw 🦞

Ce guide est conçu pour les étudiants et les développeurs souhaitant comprendre en profondeur le fonctionnement de SmallClaw, maîtriser son architecture unique et apprendre à étendre ses capacités via la création de "Skills".

## Table des Matières

1. [Introduction](#introduction)
2. [Architecture : La Philosophie du "Small Model First"](#architecture--la-philosophie-du-small-model-first)
   - [Le Concept "Single-Pass"](#le-concept-single-pass)
   - [Orchestration Multi-Agents (Optionnelle)](#orchestration-multi-agents-optionnelle)
3. [Exploration du Code Source](#exploration-du-code-source)
   - [Structure des Répertoires](#structure-des-répertoires)
   - [Composants Clés](#composants-clés)
   - [Implémentation du CLI](#implémentation-du-cli)
4. [Concepts Fondamentaux](#concepts-fondamentaux)
   - [Tool Calling Natif](#tool-calling-natif)
   - [Surgical File Editing (Édition Chirurgicale)](#surgical-file-editing-édition-chirurgicale)
   - [Gestion de la Mémoire et du Contexte](#gestion-de-la-mémoire-et-du-contexte)
5. [Le Système de Skills (Compétences)](#le-système-de-skills-compétences)
   - [Anatomie d'un SKILL.md](#anatomie-dun-skillmd)
   - [Cycle de vie d'une Skill : Du Markdown au Manifeste](#cycle-de-vie-dune-skill--du-markdown-au-manifeste)
6. [Tutoriel Pratique : Créer votre première Skill](#tutoriel-pratique--créer-votre-première-skill)
   - [Étape 1 : Définition du besoin](#étape-1--définition-du-besoin)
   - [Étape 2 : Rédaction du fichier SKILL.md](#étape-2--rédaction-du-fichier-skillmd)
   - [Étape 3 : Installation et Validation](#étape-3--installation-et-validation)
   - [Étape 4 : Test en conditions réelles](#étape-4--test-en-conditions-réelles)
7. [Conclusion et Perspectives](#conclusion-et-perspectives)

---

## Introduction

SmallClaw est un framework d'agents IA "local-first", optimisé pour s'exécuter sur des machines personnelles avec des modèles de langage de taille modeste (typiquement entre 4B et 32B de paramètres). Contrairement aux frameworks lourds qui multiplient les appels API coûteux, SmallClaw maximise l'efficacité de chaque interaction pour offrir une autonomie réelle sans frais de cloud.

---

## Architecture : La Philosophie du "Small Model First"

L'architecture de SmallClaw repose sur un principe fondamental : **les petits modèles (4B-32B) sont moins capables de planification complexe multi-étapes que les modèles géants (comme GPT-4 ou Claude 3 Opus)**. Pour compenser cela, SmallClaw utilise des stratégies spécifiques.

### Le Concept "Single-Pass"

Dans la plupart des frameworks d'agents, on trouve une boucle complexe : **Planifier -> Exécuter -> Vérifier**. Pour un modèle de 4B paramètres, cette coordination entre trois rôles différents génère souvent des erreurs ou des hallucinations.

SmallClaw v2 utilise une approche **Single-Pass (Passage Unique)** :
1. **Appel Unique** : À chaque tour de chat, un seul appel LLM est effectué.
2. **Décision Directe** : Le modèle voit ses outils (tools), l'historique récent et le message de l'utilisateur. Il décide immédiatement s'il doit répondre par du texte ou appeler un ou plusieurs outils.
3. **Réduction de Latence** : Pas de planification séparée. Si l'outil est appelé, le résultat est réinjecté dans la conversation et le modèle continue jusqu'à sa réponse finale.

Cette approche réduit radicalement la latence et augmente la fiabilité des petits modèles en leur demandant de se concentrer sur l'action immédiate plutôt que sur une stratégie globale incertaine.

### Orchestration Multi-Agents (Optionnelle)

Pour les tâches complexes, SmallClaw propose une orchestration **Conseiller (Advisor) / Exécuteur (Executor)**.

*   **L'Exécuteur (Primaire)** : C'est votre modèle local (ex: Qwen 2.5 Coder 7B). C'est lui qui possède les mains : il lit les fichiers, écrit du code et navigue sur le web.
*   **Le Conseiller (Secondaire)** : C'est un modèle optionnel (local ou cloud) qui agit comme un superviseur. Il intervient dans deux cas précis :
    *   **Preflight (Avant-vol)** : Avant que l'exécuteur ne commence, le conseiller analyse la demande, suggère un plan rapide, identifie les fichiers probables et propose des indices sur les outils à utiliser.
    *   **Rescue (Sauvetage)** : Si l'exécuteur échoue plusieurs fois (erreur d'outil, boucle infinie, stagnation), le conseiller est appelé pour diagnostiquer le problème et donner une nouvelle direction à l'exécuteur.

**Important** : Le conseiller n'exécute jamais d'outils lui-même. Il ne fait que donner des "indices de contexte" invisibles pour l'utilisateur mais injectés dans le prompt de l'exécuteur.

---

## Exploration du Code Source

Comprendre l'organisation des fichiers est essentiel pour naviguer dans le projet et savoir où apporter des modifications.

### Structure des Répertoires

Voici une vue d'ensemble des principaux dossiers du projet :

- `src/` : Le cœur du framework, écrit en TypeScript.
  - `agents/` : Contient la logique des différents rôles (Exécuteur, Manager, Vérificateur).
  - `gateway/` : Gère le serveur Express, les flux SSE (Server-Sent Events) et l'orchestration des tâches. C'est ici que se trouve le "cerveau" opérationnel.
  - `providers/` : Adaptateurs pour les différents fournisseurs de modèles (Ollama, OpenAI, etc.). C'est la couche d'abstraction LLM.
  - `tools/` : Implémentation de tous les outils que l'agent peut utiliser (fichiers, web, shell, etc.).
  - `skills/` : Logique de gestion et de traitement des "Skills" Markdown.
  - `config/` : Gestion de la configuration du système.
  - `cli/` : Code de l'interface en ligne de commande (`smallclaw`).
- `web-ui/` : Le code source de l'interface graphique (frontend).
- `assets/` : Images et ressources statiques pour la documentation et l'UI.
- `workspace/` : Le répertoire de travail par défaut où l'agent effectue ses opérations de fichiers.

### Composants Clés

Si vous souhaitez explorer le code, voici les fichiers les plus importants :

- `src/gateway/server-v2.ts` : Le point d'entrée principal du serveur. Il gère les sessions de chat et coordonne les appels au LLM.
- `src/agents/executor.ts` : Définit le comportement de l'agent primaire qui exécute les outils.
- `src/providers/factory.ts` : Responsable de la création de l'instance du fournisseur LLM approprié selon la configuration.
- `src/tools/registry.ts` : Répertorie tous les outils disponibles et les expose au framework.

### Implémentation du CLI

L'interface en ligne de commande (CLI) de SmallClaw est le point d'entrée pour les opérations système. Elle est implémentée dans `src/cli/index.ts` en utilisant la bibliothèque **Commander.js**.

#### Fonctionnement technique :
1. **Définition des commandes** : Chaque commande (`gateway`, `agent`, `onboard`, etc.) est définie avec ses arguments et options.
2. **Liaison globale** : Grâce au champ `bin` dans le `package.json` et à la commande `npm link`, le script `dist/cli/index.js` devient disponible globalement sous le nom `smallclaw`.
3. **Interactions avec le cœur** :
   - La commande `gateway start` lance le serveur Express en important `src/gateway/server-v2.ts`.
   - La commande `agent <mission>` instancie un `AgentOrchestrator` pour exécuter une tâche directement sans interface web.
   - La commande `update` gère la mise à jour automatique via `git pull` ou `npm install` selon le mode d'installation détecté.

C'est un excellent exemple de la manière de transformer une application Node.js complexe en un outil système facile à utiliser.

---

## Concepts Fondamentaux

### Tool Calling Natif

SmallClaw n'utilise pas de génération de code libre pour utiliser ses outils (ce qui est fragile). Il utilise le format **JSON Tool-Calling** natif (supporté nativement par Ollama).
- Le modèle renvoie un objet JSON : `{"tool": "read_file", "args": {"filename": "app.ts"}}`.
- SmallClaw intercepte ce JSON, exécute la fonction TypeScript correspondante, et renvoie le résultat au modèle.

### Surgical File Editing (Édition Chirurgicale)

Réécrire un fichier entier est risqué pour un petit modèle (risque d'oublier des fonctions au milieu). SmallClaw impose une édition **chirurgicale** :
1. **Lecture avec numéros de lignes** : Le modèle doit d'abord lire le fichier.
2. **Outils ciblés** : `replace_lines`, `insert_after`, `delete_lines`.
Cela force le modèle à être précis et préserve l'intégrité du code existant.

### Gestion de la Mémoire et du Contexte

Les petits modèles ont souvent une fenêtre de contexte limitée. SmallClaw gère cela par :
- **Rolling History** : Seuls les 5 derniers tours de parole sont envoyés par défaut.
- **Pinned Context** : L'utilisateur peut "épingler" des messages ou fichiers importants pour qu'ils restent toujours dans la mémoire du modèle, sans saturer le contexte avec des détails inutiles.

---

## Le Système de Skills (Compétences)

Le système de "Skills" est le moyen par lequel vous donnez de nouveaux pouvoirs à SmallClaw sans écrire de code TypeScript. C'est une extension pilotée par le **Markdown**.

### Anatomie d'un SKILL.md

Une Skill est un dossier situé dans `.smallclaw/skills/<ma-skill>/` qui doit obligatoirement contenir un fichier `SKILL.md`.

Ce fichier Markdown contient :
- **Frontmatter (Optionnel)** : Nom et description.
- **Titre (H1)** : Le nom de la compétence.
- **Description** : Un paragraphe expliquant l'objectif de la compétence.
- **Command Templates** : Une liste de commandes CLI que le modèle peut exécuter.
- **Règles et Sécurité** : Des instructions textuelles pour le comportement du modèle.

### Cycle de vie d'une Skill : Du Markdown au Manifeste

SmallClaw possède un processeur de compétences (`src/skills/processor.ts`) qui analyse vos fichiers Markdown :

1. **Scan** : Au démarrage, SmallClaw lit le dossier des compétences.
2. **Extraction** : Le processeur extrait les binaires (ex: `python`, `git`, `npm`), les variables d'environnement (ex: `OPENAI_API_KEY`) et les fichiers nécessaires.
3. **Analyse de Risque** : Le système évalue si la Skill est "Low", "Medium" ou "High risk" selon les commandes présentes. Les actions dangereuses (comme `rm`) sont marquées pour confirmation manuelle.
4. **Génération du Manifeste** : Un fichier `skill.json` est généré automatiquement. Il contient toutes les métadonnées structurées.
5. **Génération du Prompt** : Un fichier `PROMPT.md` est créé. C'est lui qui sera envoyé au modèle IA pour lui "apprendre" sa nouvelle compétence.

---

## Tutoriel Pratique : Créer votre première Skill

Dans cet exemple, nous allons créer une compétence **"Project Auditor"** qui aide à auditer la structure d'un projet étudiant.

### Étape 1 : Définition du besoin

Notre compétence doit :
- Lister les fichiers du projet.
- Rechercher des fichiers "TODO".
- Générer un rapport d'audit.

### Étape 2 : Rédaction du fichier SKILL.md

Créez le dossier `.smallclaw/skills/project-auditor/` et créez-y le fichier `SKILL.md` :

```markdown
# Project Auditor

Cette compétence permet d'analyser la structure d'un projet et de vérifier la présence de commentaires TODO.

## Instructions
- Utilisez toujours `ls -R` pour avoir une vue d'ensemble.
- Cherchez les "TODO" avec `grep`.
- Créez un fichier `AUDIT.md` pour le rapport final.

## Commandes disponibles
- Lister les fichiers : `ls -R`
- Chercher les TODO : `grep -r "TODO" .`
- Vérifier la version de Node : `node --version`
```

### Étape 3 : Installation et Validation

1. Placez votre dossier dans le répertoire `.smallclaw/skills/`.
2. Redémarrez le gateway SmallClaw (`smallclaw gateway start`).
3. Allez dans l'interface web, onglet **Skills**. Vous devriez voir "Project Auditor".
4. Vérifiez le statut : Si `node` est installé sur votre machine, la compétence passera en "Ready".

### Étape 4 : Test en conditions réelles

Dans le chat, demandez simplement :
> "Utilise ta compétence Project Auditor pour analyser mon projet actuel et me faire un rapport."

Le modèle chargera alors le `PROMPT.md` généré et saura exactement quels outils utiliser et quelles règles suivre.

---

## Conclusion et Perspectives

SmallClaw démontre qu'avec une architecture bien pensée, les petits modèles de langage peuvent rivaliser en autonomie avec les plus grands. En maîtrisant les Skills, vous pouvez transformer SmallClaw en un assistant spécialisé pour n'importe quel domaine : DevOps, Rédaction, Analyse de données, ou même Domotique.

Félicitations ! Vous avez maintenant les clés pour maîtriser SmallClaw et construire vos propres agents intelligents locaux. 🦞
