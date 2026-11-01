# Changelog

## 1.1.0 — 2026-11-01

- Chemin de la valeur sélectionnée : un clic sur une ligne affiche son chemin
  (`data.items[3].id`) dans une barre en bas de page, en notation JS ou jq.
- Boutons « Copier le chemin » et « Copier la valeur » (JSON indenté fidèle à
  la source : ordre des clés, texte exact des nombres, clés dupliquées).

## 1.0.0 — 2026-11-01

Première version.

- Détection par `Content-Type` JSON ou par contenu (objet/tableau valide).
- Arborescence colorée et pliable, compteur `{… n items}`, Alt+clic récursif.
- Barre d'outils : Tout développer, Tout réduire, Formatted / Raw.
- Thème clair/sombre automatique.
- Au-delà de 2 Mo : vue brute par défaut et avertissement.
- Parseur fidèle : ordre des clés, texte exact des nombres, clés dupliquées.
- URL http(s) cliquables, BOM et préfixes anti-XSSI ignorés.
