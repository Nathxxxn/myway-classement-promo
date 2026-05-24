# MyWay - Classement Promo

Extension Chrome Manifest V3 qui ajoute des informations de classement promo sur la page MyWay CentraleSupelec.

Developpe par Nathan Di Fraja.

Projet independant, non affilie a CentraleSupelec ou MyWay.

## Fonctionnalites

- Affiche le classement general pour l'annee universitaire et les semestres disponibles.
- Ajoute des statistiques de distribution : moyenne, mediane, minimum et maximum.
- Affiche le classement d'une matiere dans la fenetre de statistiques MyWay apres clic sur le graphique.
- Met en cache les statistiques generales pour accelerer l'affichage.
- N'ajoute rien dans les lignes de matieres afin de ne pas ralentir l'utilisation du site.

## Installation

### Chrome

1. Telecharge le depot depuis GitHub :
   - clique sur `Code` ;
   - puis `Download ZIP` ;
   - decompresse le fichier ZIP.
2. Ouvre Chrome et va sur :

   ```text
   chrome://extensions
   ```

3. Active le `Mode developpeur` en haut a droite.
4. Clique sur `Charger l'extension non empaquetee`.
5. Selectionne le dossier de l'extension, celui qui contient `manifest.json`.
6. Ouvre ou recharge MyWay :

   ```text
   https://myway.centralesupelec.fr/curriculum
   ```

### Microsoft Edge

1. Telecharge et decompresse le depot.
2. Ouvre :

   ```text
   edge://extensions
   ```

3. Active le mode developpeur.
4. Clique sur `Charger l'extension decompressee`.
5. Selectionne le dossier contenant `manifest.json`.

### Brave

1. Telecharge et decompresse le depot.
2. Ouvre :

   ```text
   brave://extensions
   ```

3. Active le mode developpeur.
4. Clique sur `Charger l'extension non empaquetee`.
5. Selectionne le dossier contenant `manifest.json`.

## Utilisation

Sur la page `Mon parcours` de MyWay :

- le bloc de classement general apparait sous l'annee universitaire `2025-2026` ;
- les classements par matiere apparaissent lorsque tu ouvres le graphique/statistiques d'une matiere.

Si le classement general ne s'affiche pas immediatement, recharge la page. L'extension precharge les donnees au demarrage et utilise un cache local pour les chargements suivants.

## Mise a jour

Si tu installes une nouvelle version manuellement :

1. telecharge la nouvelle version du depot ;
2. remplace l'ancien dossier local ;
3. retourne dans `chrome://extensions` ;
4. clique sur le bouton de rechargement de l'extension.

## Developpement

L'extension est volontairement simple :

- `manifest.json` : configuration Manifest V3 ;
- `content.js` : logique injectee sur MyWay ;
- `popup.html` : popup "A propos" ;
- `tests/content.test.js` : tests Node du content script.

Lancer les tests :

```bash
node --test tests/content.test.js
```

Verifier la syntaxe du content script :

```bash
node --check content.js
```

Verifier le manifest :

```bash
python3 -m json.tool manifest.json
```

## Permissions

L'extension demande l'acces a :

```text
https://myway.centralesupelec.fr/*
```

Cet acces est necessaire pour lire les donnees de notes et statistiques exposees par MyWay pendant ta session connectee.

## Confidentialite

L'extension fonctionne localement dans le navigateur. Elle ne configure aucun serveur externe et ne transmet pas les donnees MyWay a un service tiers.

## Licence

Ce depot est publie sans licence open source explicite pour le moment. Tous droits reserves a l'auteur.
