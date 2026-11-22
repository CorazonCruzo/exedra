#!/bin/bash
# Уголок под балконом: сборка всех вещей из оригиналов (вне git) в assets/models/lounge.
# Запуск из корня проекта: ORIG=/путь/к/originals/lounge tools/models/lounge/build_lounge.sh
set -e
ORIG=${ORIG:-$H/../../../originals/lounge}
OUT=assets/models/lounge; T=tools/models/lounge; W=$(mktemp -d)
BL="/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python"
mkdir -p $OUT
prep() { $BL $T/prep.py -- "$@" 2>&1 | grep -E "PREP|Error|Trace" || true; }
prep $ORIG/armchair/chair.glb $W/armchair.glb --rot 180 --scale 0.78 --side 1024 --rough-lift Image_1:0.35
python3 -I $T/post.py $W/armchair.glb $OUT/armchair.glb --rough 1 --base 0.66,0.56,0.56
prep $ORIG/sofa/sofa.glb $W/sofa.glb --scale 0.0077 --side 1024 --rough-lift Image_1:0.2
python3 -I $T/post.py $W/sofa.glb $OUT/sofa.glb --mat main_leather --rough 1 --base 0.85,0.8,0.78
prep $ORIG/coffee-table/gothic_coffee_table_2k.gltf $W/coffee-table.glb --tris 14000 --side 1024
prep $ORIG/side-table/round_wooden_table_02_1k.gltf $W/side-table.glb --side 1024
$BL $T/rug_build.py -- $ORIG/rug/rug.glb $W/rug.glb --side 1536 2>&1 | grep -E "RUG|Error|Trace" || true
python3 -I $T/post.py $W/rug.glb $OUT/rug.glb --mask=fringe:0.5
prep $ORIG/lamps/lamps.glb $W/floor-lamp-a.glb --keep Object_8 --height 1.62 --side 512
prep $ORIG/lamps/lamps.glb $W/floor-lamp-b.glb --keep Object_12 --height 1.62 --side 512
prep $ORIG/projector/projector.glb $W/projector.glb --scale 100 --tris 20000 --side 2048
prep $ORIG/chess/chess.glb $W/chess-set.glb --scale 0.01 --side 1024
for n in coffee-table side-table floor-lamp-a floor-lamp-b projector chess-set; do python3 -I $T/post.py $W/$n.glb $OUT/$n.glb >/dev/null; done
ls -l $OUT
