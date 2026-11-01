# Cahier des charges : extension Chromium « JSON Helper »

> Conversion Markdown du cahier des charges d'origine.

## 1. Objectif du projet

Développer une extension Chromium (compatible Brave) légère, fluide et sans dépendances lourdes, qui intercepte l'affichage des réponses JSON brutes dans le navigateur pour les présenter sous forme d'arborescence interactive et colorée.

## 2. Spécifications fonctionnelles

### 2.1 Détection du contenu

- L'extension doit s'exécuter uniquement sur les pages dont le contenu est du JSON valide.
- **Critères de déclenchement :**
  - le header `Content-Type` de la réponse contient `application/json`, **OU**
  - le contenu brut du `document.body` s'apparente à un objet ou à un tableau JSON (`JSON.parse` réussi sans erreur).

### 2.2 Rendu et mise en page

- **Remplacement du DOM :** masquer ou vider la page texte brut initiale et injecter une interface propre.
- **Coloration syntaxique :** des couleurs distinctes pour :
  - les clés d'objets (`"key":`) ;
  - les chaînes de caractères (`"string"`) ;
  - les nombres (`42`) ;
  - les booléens (`true` / `false`) ;
  - les valeurs nulles (`null`).
- **Arborescence pliable (fold/unfold) :**
  - une flèche ou une icône à côté de chaque objet `{}` ou tableau `[]` ;
  - un clic sur la flèche masque ou affiche tout le bloc d'enfants correspondant ;
  - le nombre d'éléments masqués s'affiche à côté du bloc replié (ex. `{... 12 items}`).

### 2.3 Commandes globales et options

- **Barre d'outils / en-tête :**
  - bouton **« Tout développer »** (Expand All) ;
  - bouton **« Tout réduire »** (Collapse All) ;
  - bouton de bascule **« Raw / Formatted »** pour revenir instantanément au JSON brut initial.
- **Support du thème :** adaptation automatique au mode sombre ou clair du système (via `prefers-color-scheme`).

## 3. Spécifications techniques

### 3.1 Architecture

- **Standard :** Manifest V3 (norme Chromium actuelle).
- **Technologies :** HTML5, CSS3, JavaScript vanilla. Aucun framework lourd (React, Vue…) n'est requis, pour garder de la légèreté.
- **Fichiers requis :**
  1. `manifest.json` : déclaration de l'extension et des droits ;
  2. `content.js` : script injecté qui analyse et transforme la page ;
  3. `styles.css` : feuille de style (thèmes, coloration et gestion des flèches).

### 3.2 Structure du `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "JSON Helper",
  "version": "1.0.0",
  "description": "Formate et structure les réponses JSON dans le navigateur.",
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_end"
    }
  ]
}
```

## 4. Contraintes de performance et cas limites

- **Gestion du volume :** si le JSON dépasse **2 Mo**, désactiver l'arborescence interactive par défaut ou afficher un avertissement, pour ne pas bloquer le fil d'exécution du navigateur (*main thread*).
- **Sécurité :** ne transmettre aucune donnée JSON à un serveur tiers (traitement 100 % local dans le navigateur).

## Écarts et compléments apportés lors de la réalisation

| Point | Décision |
|---|---|
| Manifest | Ajout de `icons` et `minimum_chrome_version` ; aucune permission supplémentaire. |
| Détection `Content-Type` | Lu via `document.contentType`, car une content script n'a pas accès aux headers HTTP. Accepte aussi `text/json` et `application/*+json`. |
| CSS sur `<all_urls>` | Tous les sélecteurs sont préfixés (`.jh-*`) pour ne pas affecter les autres sites. |
| Gros fichiers | Les deux options du §4 sont combinées : vue brute par défaut **et** avertissement avec un bouton pour forcer l'arborescence. |
| Fidélité | Parseur dédié à l'affichage : ordre des clés conservé, nombres non arrondis, clés dupliquées visibles. |
| Ajouts | Alt+clic récursif, index de tableau, liens http(s) cliquables, BOM et préfixes anti-XSSI ignorés, navigation au clavier. |
