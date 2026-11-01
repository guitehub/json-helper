# Recette manuelle — JSON Helper

À dérouler sur **Chrome** et **Brave** avant chaque version.

## Préparation

```sh
node scripts/make-large-fixture.js          # crée test/fixtures/large.json (~5 Mo)
cd test/fixtures && python3 -m http.server 8000
```

Installer l'extension (voir README), activer « Autoriser l'accès aux URL de fichiers ».

## Détection (§2.1)

| # | URL | Attendu | Chrome | Brave |
|---|---|---|---|---|
| D1 | http://localhost:8000/simple.json | Arborescence affichée | ☐ | ☐ |
| D2 | http://localhost:8000/as-text.txt (text/plain) | Arborescence affichée (heuristique) | ☐ | ☐ |
| D3 | http://localhost:8000/html-body-json.html (text/html) | Arborescence affichée | ☐ | ☐ |
| D4 | http://localhost:8000/invalid.json | Page **inchangée** (texte brut) | ☐ | ☐ |
| D5 | http://localhost:8000/not-json.html | Page HTML **inchangée** | ☐ | ☐ |
| D6 | Un site quelconque (ex. wikipedia.org) | Aucun changement visuel | ☐ | ☐ |
| D7 | `file://…/test/fixtures/simple.json` | Arborescence affichée | ☐ | ☐ |
| D8 | http://localhost:8000/xssi-prefix.json | Arborescence ; « Raw » montre le préfixe `)]}',` | ☐ | ☐ |
| D9 | http://localhost:8000/bom.json | Arborescence | ☐ | ☐ |
| D10 | http://localhost:8000/root-primitive.json | Affiche `42` ; boutons Tout développer/réduire grisés | ☐ | ☐ |

## Rendu (§2.2)

| # | Fixture | Attendu | Chrome | Brave |
|---|---|---|---|---|
| R1 | simple.json | Clés, chaînes, nombres, booléens, null de couleurs distinctes | ☐ | ☐ |
| R2 | nested.json | Clic sur ▾ replie le bloc → `{… n items}` ; reclic le rouvre | ☐ | ☐ |
| R3 | nested.json | Clic sur `… n items` déplie aussi | ☐ | ☐ |
| R4 | nested.json | Alt+clic sur la racine replie tout ; Alt+clic la redéplie entièrement | ☐ | ☐ |
| R5 | edge-cases.json | Ordre des clés : b, 2, a, 1 ; `12345678901234567890` intact ; deux clés `dup` | ☐ | ☐ |
| R6 | edge-cases.json | `{}` et `[]` vides sans flèche ; la longue chaîne revient à la ligne | ☐ | ☐ |
| R7 | unicode.json | Accents, japonais, emoji, arabe corrects ; clé vide `""` | ☐ | ☐ |
| R8 | xss.json | **Aucune alerte** ; balises affichées en texte ; seul `https://…` est un lien | ☐ | ☐ |
| R9 | root-array.json | Index `0:`, `1:`… affichés en gris | ☐ | ☐ |
| R10 | simple.json | Tab atteint les flèches ; Entrée / Espace plie / déplie | ☐ | ☐ |

## Commandes globales et thème (§2.3)

| # | Attendu | Chrome | Brave |
|---|---|---|---|
| C1 | « Tout réduire » : seule la racine reste ouverte | ☐ | ☐ |
| C2 | « Tout développer » : tout est ouvert | ☐ | ☐ |
| C3 | « Raw » : texte brut d'origine identique à la source ; boutons Tout développer/réduire grisés | ☐ | ☐ |
| C4 | « Formatted » : retour à l'arbre dans l'état où on l'avait laissé | ☐ | ☐ |
| C5 | Système en mode sombre → thème sombre ; en clair → thème clair (bascule à chaud) | ☐ | ☐ |
| C6 | La barre d'outils reste visible au défilement | ☐ | ☐ |

## Performance et sécurité (§4)

| # | Attendu | Chrome | Brave |
|---|---|---|---|
| P1 | large.json : vue Raw par défaut + bandeau d'avertissement | ☐ | ☐ |
| P2 | « Afficher l'arborescence quand même » : arbre affiché (2 niveaux ouverts) | ☐ | ☐ |
| P3 | « Tout développer » sur large.json : la page reste réactive (défilement possible pendant l'opération) | ☐ | ☐ |
| P4 | DevTools → Network : **aucune requête** émise par l'extension | ☐ | ☐ |
| P5 | `chrome://extensions` → Détails : aucune permission listée hormis l'accès aux sites | ☐ | ☐ |

Version testée : ________  Date : ________  Testeur : ________
