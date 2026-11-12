# Scène 3D du site

- `scene_finale12.glb` : scène utilisée par le site (chargée dans `three_launcher.js`).
  C'est `scene_finale11` avec les objets fusionnés par zone (568 → 22 objets)
  et la géométrie compressée en Draco (4,7 Mo → 0,5 Mo). Décodeur : `js/draco/`.
- `scene_finale11.glb` : scène nettoyée, non fusionnée et non compressée.
- `scene_finale10.glb` : version d'origine (octobre 2020), gardée pour comparaison.

## Fabrication de `scene_finale12.glb`

1. `scene_finale11_clean.blend` → `tools/blender_merge_zones.py` : applique
   les transformations (plus d'objets en miroir), regroupe par case de 12 × 12
   unités au sol, puis par paquets de 8 000 triangles max, et joint chaque
   paquet. Sauvegarde `scene_finale12_clean.blend` (même dossier que
   `scene_finale11_clean.blend`) et exporte un `.glb` brut.

   ```
   blender -b scene_finale11_clean.blend --python tools/blender_merge_zones.py -- scene_finale12_clean.blend brut.glb rapport.json
   ```

2. Compression avec gltf-transform :

   ```
   npx @gltf-transform/cli@4.1.1 prune brut.glb tmp.glb
   npx @gltf-transform/cli@4.1.1 draco tmp.glb models/scene_finale12.glb --method edgebreaker --quantize-position 16 --quantize-normal 10
   ```

Le décalque bois (`scene_effects.js`) utilise un index spatial (BVH) maison :
les zones fusionnées font jusqu'à 8 000 triangles et le rayon de three.js
aurait été 50 fois plus lent.

## D'où vient `scene_finale11.glb`

Aucun `.blend` ne correspond exactement à `scene_finale10.glb` : la scène a été
modifiée après le dernier enregistrement de
`bow_vosgien/bv_website/models/modeles_clean/scene_finale2.blend` (par exemple
22 lumières ponctuelles dans le .glb contre 16 dans le .blend).

`scene_finale11.glb` a donc été reconstruit à partir de `scene_finale10.glb`
avec Blender 5.1 et le script `tools/blender_clean_scene.py`, qui :

1. remplace les 6 matériaux gris (`default*`, `wire_*`) par le matériau blanc
   `01___Default.002` : tous les objets ont la même couleur ;
2. fusionne les sommets dupliqués, supprime faces dégénérées et sommets isolés ;
3. réoriente les faces de façon cohérente (66 objets corrigés, dont le rideau
   et les poutres treillis du théâtre) ;
4. fusionne les faces coplanaires (aucun changement de forme) ;
5. simplifie de moitié les statues « Lucy » et les `Steltman` ;
6. supprime les clés de caméra avant t = 0 (caméra immobile) pour que
   l'animation reste calée sur les mêmes temps que l'original.

Résultat : 118 313 → 107 698 triangles, un seul matériau, animation caméra
identique (écart < 0,0001 unité), lumières identiques.

Le `.blend` correspondant (à utiliser pour les prochaines retouches) :
`bow_vosgien/bv_website/models/modeles_clean/scene_finale11_clean.blend`.

Pour réexporter après une retouche dans ce `.blend` : glTF binaire, **+Y up**,
caméras, lumières (mode d'éclairage « Raw »), animations, modificateurs
appliqués, sans compression Draco.

Régénérer depuis l'original :

```
blender -b --python tools/blender_clean_scene.py -- models/scene_finale10.glb <sortie.blend> models/scene_finale11.glb <rapport.json>
```

## Non traité

Les poutres treillis du théâtre (`Cylinder.*`, environ 48 000 triangles) ne
sont pas simplifiées : la simplification automatique écrase leurs barres
diagonales. Pour les alléger, il faudrait remodéliser les barres avec moins de
côtés.
