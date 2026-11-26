# THE COACH — programmation d'entraînement Hyrox

Application web installable (PWA), gratuite, utilisable sur PC (Edge / Chrome) et iPhone (Safari), hors connexion.

- **Comptes** : nom d'utilisateur + code à 4 chiffres. Le même compte sur tous ses appareils.
- **Planning** personnel à la semaine (plusieurs séances par jour), synchronisé entre ses appareils, invisible des autres.
- **Affiche de la semaine** en image PNG (Instagram, WhatsApp) ou PDF (e-mail, impression).
- **Séances** : exercices en séries (séries variables 12/10/8 possibles) ou WOD (Rounds, For time, AMRAP, EMOM), repos entre séries / exercices / tours, ordre modifiable par glisser-déposer.
- **Bibliothèque d'exercices** : nom, symbole (emoji) ou photo, type par défaut (reps / temps / distance / calories) et charge en kg.
- **Mode séance** : les exercices au temps, repos et préparations s'enchaînent seuls (bips sur les 5 dernières secondes) ;
  les exercices aux répétitions / distance / calories passent avec le bouton « Suivant ». Préparation de 10 s avant chaque
  exercice (réglable dans Réglages, sauf si un repos est programmé juste avant, et jamais à l'intérieur d'un WOD).
- **Résultats** : à la fin, résumé des temps par exercice, moyenne par exercice, temps total (avec et sans repos), ressenti
  (RPE 1-10 + commentaire), affiche PNG. Les temps se corrigent avant ou après l'enregistrement.
- **Historique** : graphique d'évolution par séance (temps total, temps moyen d'un exercice, tours d'AMRAP), avec repère
  « Δ » quand la séance a été modifiée entre deux passages (charge, répétitions…). Visible par soi seul.
- **Bibliothèques communes** (exercices + séances) à l'équipe.

Règle de modification : quand une séance ou un exercice de la bibliothèque est modifié, **seules les séances planifiées
à partir d'aujourd'hui** sont mises à jour. Les séances passées restent telles qu'elles étaient.

---

## 1. Mettre l'application en ligne (GitHub Pages, gratuit)

1. Se connecter sur <https://github.com> (avec le compte Google).
2. Bouton **New repository** → nom : `the-coach` → **Public** → *Create repository*.
3. Sur la page du dépôt : **uploading an existing file** → glisser les fichiers `index.html`, `sw.js`,
   `manifest.webmanifest`, `firebase-config.js`, `README.md` et les dossiers `css`, `js`, `icons` → *Commit changes*.
   - Le dossier `outils` et le dossier `.claude` ne sont pas nécessaires.
4. **Settings** → **Pages** → *Source* : `Deploy from a branch` → Branch : `main` / `(root)` → *Save*.
5. Après 1 à 2 minutes, l'adresse s'affiche : `https://<votre-pseudo>.github.io/the-coach/`.

Pour une mise à jour : **Add file → Upload files**, glisser les fichiers modifiés (ou tout) → *Commit changes*.
Les appareils la reçoivent à la prochaine ouverture avec connexion.

## 2. Firebase (comptes + synchro) — une seule fois

1. <https://console.firebase.google.com> → **Créer un projet** → Google Analytics : *désactivé*.
2. **Build → Firestore Database** → *Créer une base de données* → région `europe-west` → mode **production**.
3. **Build → Authentication** → *Commencer* → onglet **Sign-in method** :
   - activer **Adresse e-mail/Mot de passe** (premier interrupteur seulement, pas « Lien par e-mail ») → *Enregistrer* ;
   - désactiver **Anonyme** s'il est activé (il n'est plus utilisé).
4. Onglet **Règles** de Firestore → remplacer tout le contenu par le bloc ci-dessous → **Publier**.

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isOwner(name) {
         return request.auth != null
           && request.auth.token.email == name + '@the-coach-59dff.firebaseapp.com';
       }
       // Bibliothèques communes : tout compte connecté qui connaît le code d'équipe.
       match /teams/{team}/{coll}/{docId} {
         allow read, write: if request.auth != null && coll in ['exercises', 'sessions'];
       }
       // Profil, planning et résultats : uniquement le propriétaire du compte.
       match /users/{name} {
         allow read, write: if isOwner(name);
         match /{coll}/{docId} {
           allow read, write: if isOwner(name) && coll in ['plan', 'results'];
         }
       }
     }
   }
   ```
   `the-coach-59dff.firebaseapp.com` = la valeur `authDomain` du fichier `firebase-config.js`.
5. Roue crantée → **Paramètres du projet** → *Vos applications* → icône **Web `</>`** → copier le bloc
   `firebaseConfig` dans `firebase-config.js`. Il n'y a rien de secret dans ce bloc : ce sont les règles qui protègent les données.

## 3. Créer les comptes

1. Le premier (l'administrateur) ouvre l'app → **Créer un compte** → nom, code à 4 chiffres, prénom →
   coche **Je crée une nouvelle équipe**.
   *(Si une équipe existait déjà avec l'ancienne version, saisir plutôt son code d'équipe pour retrouver les bibliothèques.)*
2. **Réglages → Équipe** : copier le **code d'équipe** et l'envoyer aux amis avec le lien de l'app.
3. Chaque ami : **Créer un compte** → son nom, son code, et le code d'équipe reçu.
4. Sur ses autres appareils, chacun fait simplement **Se connecter** avec son nom et son code.

### Code oublié

Il n'y a pas d'e-mail dans les comptes, donc pas de réinitialisation automatique :

1. L'administrateur ouvre la console Firebase → **Authentication → Users** → ligne `nom@the-coach-59dff.firebaseapp.com`
   → menu **⋮** → **Supprimer le compte**.
2. La personne refait **Créer un compte** avec **le même nom** et un nouveau code : son planning, son profil et ses
   résultats sont retrouvés (le code d'équipe n'est pas redemandé).

Quand on connaît son code, on peut le changer dans **Réglages → Mon compte → Changer mon code**.

## 4. Installer sur chaque appareil

- **iPhone** : ouvrir le lien dans **Safari** → bouton *Partager* → **Sur l'écran d'accueil**.
  Toujours utiliser l'icône de l'écran d'accueil ensuite.
- **PC** : ouvrir le lien dans **Edge** ou **Chrome** → icône *Installer* dans la barre d'adresse
  (ou menu … → Applications → Installer).

La première connexion demande internet ; ensuite l'app fonctionne hors connexion et synchronise au retour du réseau.

## 5. Bon à savoir

- **Sécurité** : un code à 4 chiffres est un verrou léger, adapté à un usage entre amis. Firebase bloque temporairement
  un compte après de nombreux essais ratés.
- **Temporisation** : *Réglages → Mode séance* (10 s par défaut, 0 = aucune). Réglage propre à chaque appareil.
- **iPhone et son** : le mode séance émet des bips. Si l'iPhone est en mode silencieux, le son peut être coupé selon la
  version d'iOS. Monter le volume avant la séance.
- **Écran** : le mode séance demande à garder l'écran allumé (si le navigateur le permet).
- **Clavier sur PC (mode séance)** : `→` ou `Entrée` = suivant, `←` = précédent, `Espace` = pause, `Échap` = quitter.
- **Sauvegarde fichier** : *Réglages → Sauvegarde complète* (planning + résultats), en plus de la sauvegarde en ligne.

## Tester en local sur le PC

```powershell
powershell -ExecutionPolicy Bypass -File outils\serveur-local.ps1
```
puis ouvrir <http://localhost:8080>.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html`, `css/styles.css` | page et style |
| `js/app.js` | écrans : connexion, planning, séances, éditeur, exercices, réglages |
| `js/store.js` | données locales, règle « futur uniquement », export / import |
| `js/sync.js` | comptes et synchro Firebase |
| `js/player.js` | mode séance (chrono, enchaînements, alarmes, mesure des temps) |
| `js/results.js` | résumé de fin de séance, moyennes, comparaison des versions |
| `js/history.js` | historique et graphiques |
| `js/poster.js` | affiches PNG / PDF (semaine, résultat) |
| `js/ui.js`, `js/format.js`, `js/utils.js`, `js/dnd.js`, `js/seed.js` | interface, mise en forme, utilitaires, glisser-déposer, données de départ |
| `sw.js`, `manifest.webmanifest`, `icons/` | installation et fonctionnement hors connexion |
