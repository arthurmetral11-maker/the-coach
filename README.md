# THE COACH — programmation d'entraînement Hyrox

Application web installable (PWA), gratuite, utilisable sur PC (Edge / Chrome) et iPhone (Safari), hors connexion.

- **Planning** personnel à la semaine (plusieurs séances par jour possibles), détail d'une séance au clic.
- **Affiche de la semaine** en image PNG (Instagram, WhatsApp) ou PDF (e-mail, impression).
- **Séances** : exercices en séries (séries variables 12/10/8 possibles) ou WOD (Rounds, For time, AMRAP, EMOM), repos entre séries / exercices / tours, ordre modifiable par glisser-déposer.
- **Bibliothèque d'exercices** : nom, symbole (emoji) ou photo, type par défaut (reps / temps / distance / calories) et charge en kg.
- **Mode séance** : suivi pas à pas, chronomètre, minuteurs avec alarme sonore, bouton « Suivant ».
- **Bibliothèques communes** (exercices + séances) entre amis, par synchro en ligne (Firebase) ou par fichier.

Règle de modification : quand une séance ou un exercice de la bibliothèque est modifié, **seules les séances planifiées
à partir d'aujourd'hui** sont mises à jour. Les séances passées restent telles qu'elles étaient.

---

## 1. Mettre l'application en ligne (GitHub Pages, gratuit) — une seule fois

1. Se connecter sur <https://github.com> (avec le compte Google).
2. Bouton **New repository** → nom : `the-coach` → **Public** → *Create repository*.
3. Sur la page du dépôt : **uploading an existing file** → glisser **tout le contenu** du dossier `02-THE COACH`
   (fichiers `index.html`, `sw.js`, `manifest.webmanifest`, `firebase-config.js`, `README.md` et les dossiers `css`, `js`, `icons`)
   → *Commit changes*.
   - Le dossier `outils` et le dossier `.claude` ne sont pas nécessaires.
4. **Settings** → **Pages** → *Source* : `Deploy from a branch` → Branch : `main` / `(root)` → *Save*.
5. Après 1 à 2 minutes, l'adresse s'affiche : `https://<votre-pseudo>.github.io/the-coach/`. C'est le lien à envoyer aux amis.

Pour une mise à jour : ré-uploader les fichiers modifiés dans le dépôt. Les appareils la reçoivent à la prochaine ouverture
(avec connexion).

## 2. Installer sur chaque appareil

- **iPhone** : ouvrir le lien dans **Safari** → bouton *Partager* → **Sur l'écran d'accueil**.
  Toujours utiliser l'icône de l'écran d'accueil ensuite (les données y sont conservées).
- **PC** : ouvrir le lien dans **Edge** ou **Chrome** → icône *Installer* dans la barre d'adresse
  (ou menu … → Applications → Installer).

Chacun renseigne ensuite son **prénom** et la **date de son Hyrox** dans *Réglages*.

## 3. Activer la synchro des bibliothèques (Firebase, gratuit) — une seule fois

1. Aller sur <https://console.firebase.google.com> → **Créer un projet** → nom `the-coach` → Google Analytics : *désactivé*.
2. Menu **Build → Firestore Database** → *Créer une base de données* → région `europe-west` (ex. `eur3`) → mode **production**.
3. Onglet **Règles** de Firestore → remplacer tout le contenu par :

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /teams/{team}/{coll}/{docId} {
         allow read, write: if request.auth != null && coll in ['exercises', 'sessions'];
       }
     }
   }
   ```
   → **Publier**.
4. Menu **Build → Authentication** → *Commencer* → onglet *Sign-in method* → activer **Anonyme**.
5. Roue crantée → **Paramètres du projet** → *Vos applications* → icône **Web `</>`** → nom `the-coach` → *Enregistrer l'application*.
   Firebase affiche un bloc `const firebaseConfig = { ... }`.
6. Copier ce bloc dans le fichier `firebase-config.js` (remplacer `null`), puis ré-uploader ce fichier sur GitHub.
   Il n'y a rien de secret dans ce bloc : ce sont les règles de l'étape 3 qui protègent les données.
7. Dans l'application → *Réglages* → **Générer un code** d'équipe → *Connecter*. Envoyer ce code aux 2 amis, qui le collent
   dans leurs *Réglages* puis *Connecter*. Le point vert en haut indique que c'est synchronisé.

Le **code d'équipe** sert de « mot de passe » commun : seules les personnes qui le connaissent voient vos bibliothèques.

Sans Firebase, tout fonctionne quand même. Pour partager : *Réglages* → **Exporter les bibliothèques** (envoi par
WhatsApp ou e-mail), et l'ami fait **Importer un fichier**. La fusion se fait sans doublon : la version la plus récente gagne.

## 4. Bon à savoir

- **Sauvegarde** : *Réglages* → *Sauvegarde complète (avec mon planning)*. À faire de temps en temps, car le planning n'est
  stocké que sur l'appareil.
- **iPhone et son** : le mode séance émet des bips. Si l'iPhone est en mode silencieux, le son peut être coupé selon la
  version d'iOS. Monter le volume avant la séance.
- **Écran** : le mode séance demande à garder l'écran allumé (si le navigateur le permet).
- **Clavier sur PC (mode séance)** : `→` ou `Entrée` = suivant, `←` = précédent, `Espace` = pause, `Échap` = quitter.

## Tester en local sur le PC

```powershell
powershell -ExecutionPolicy Bypass -File outils\serveur-local.ps1
```
puis ouvrir <http://localhost:8080>.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html`, `css/styles.css` | page et style |
| `js/app.js` | écrans : planning, séances, éditeur, exercices, réglages |
| `js/store.js` | données locales, règle « futur uniquement », export / import |
| `js/sync.js` | synchro Firebase des bibliothèques |
| `js/player.js` | mode séance (chrono, alarmes) |
| `js/poster.js` | affiche PNG / PDF |
| `js/format.js`, `js/utils.js`, `js/dnd.js`, `js/seed.js` | mise en forme, utilitaires, glisser-déposer, données de départ |
| `sw.js`, `manifest.webmanifest`, `icons/` | installation et fonctionnement hors connexion |
