#!/bin/bash
# Три варианта пальмы в спокойной кадке: palm-a (ящик «Версаль»), palm-b (медная ванна), palm-c (зелёный горшок).
# ORIG=.../originals/lounge-extras OUT=assets/models/lounge  tools/models/lounge/palm_calm.sh [a|b|c ...]
set -e
H="$(cd "$(dirname "$0")" && pwd)"; B=/Applications/Blender.app/Contents/MacOS/Blender
ORIG=${ORIG:-$H/../../../originals/lounge-extras}; OUT=${OUT:-$H/../../../assets/models/lounge}
TMP=$(mktemp -d)
for k in ${@:-a b c}; do
  case $k in
    a) ARGS="--kind a --planter-h 0.5 --tex 1024"; TINT="--mat wood --base 0.105,0.042,0.036" ;;
    b) ARGS="--kind b --src $ORIG/copper-tubs/copper-boiling-tubs.glb --planter-h 0.46 --tex 1024 --p1 -0.15,0 --p2 0.18,0.0"; TINT="" ;;
    c) ARGS="--kind c --src $ORIG/green-pot/green-glazed-flower-pot.glb --planter-h 0.5 --tex 1024 --tris 5800"; TINT="" ;;
  esac
  $B -b --factory-startup --python "$H/palm_calm_build.py" -- "$ORIG/palm/palm-original.glb" "$TMP/$k.glb" $ARGS
  python3 -I "$H/post.py" "$TMP/$k.glb" "$TMP/$k-p.glb" --mat DYPSIS --metal 0 --base 0.78,0.88,0.72 --mask=DYPSIS:0.5
  if [ -n "$TINT" ]; then python3 -I "$H/post.py" "$TMP/$k-p.glb" "$OUT/palm-$k.glb" $TINT; else cp "$TMP/$k-p.glb" "$OUT/palm-$k.glb"; fi
done
