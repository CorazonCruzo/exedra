#!/bin/bash
# Коробки с плёнкой (assets/models/lounge/reels.glb) из «Pathé 9.5mm film reels» (timvanderheijden, CC BY 4.0, Sketchfab).
# ORIG=.../originals/lounge-extras/reels  tools/models/lounge/reels.sh [--k 1.6 ...]   (оригинал: $ORIG/pathe-9.5mm-film-reels.glb — скачан через вход на Sketchfab)
set -e
H="$(cd "$(dirname "$0")" && pwd)"; B=/Applications/Blender.app/Contents/MacOS/Blender
ORIG=${ORIG:-$H/../../../originals/lounge-extras/reels}; OUT=${OUT:-$H/../../../assets/models/lounge}
TMP=$(mktemp -d)
$B -b --factory-startup --python "$H/reels_build.py" -- "$ORIG/pathe-9.5mm-film-reels.glb" "$TMP/reels.glb" "$@" 2>&1 | grep -E "REELS|Error|Trace" || true
# свет в текстуре уже запечён, поэтому при обычном освещении цвет чуть гасится множителем
python3 -I "$H/post.py" "$TMP/reels.glb" "$OUT/reels.glb" --base 0.78,0.70,0.62
ls -l "$OUT/reels.glb"; rm -rf "$TMP"
