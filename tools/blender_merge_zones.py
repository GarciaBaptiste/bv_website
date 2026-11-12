# Fusionne les objets de la scène par zone pour réduire les appels de dessin.
# Usage : blender -b <in.blend> --python blender_merge_zones.py -- <out.blend> <out.glb> <report.json>
#
# - applique toutes les transformations dans la géométrie (supprime au passage
#   les échelles négatives : les faces sont retournées pour rester à l'endroit)
# - regroupe les objets par case de CELL x CELL unités au sol, puis découpe
#   chaque case en groupes d'au plus MAX_TRIS triangles (la détection des clics
#   et la pose du bois restent rapides)
# - joint chaque groupe en un seul objet
import bpy, bmesh, json, sys, math
from collections import defaultdict
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT_BLEND, OUT_GLB, REPORT = args[:3]
CELL = 12.0
MAX_TRIS = 8000

D = bpy.data
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == 'MESH']
report = {"objects_before": len(meshes)}

def tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)

# 1. Transformations appliquées dans la géométrie
flipped = 0
for o in meshes:
    if o.data.users > 1:
        o.data = o.data.copy()
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    o.data.transform(mw)
    if mw.determinant() < 0:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(o.data)
        bm.free()
        flipped += 1
    o.data.update()
report["mirrored_fixed"] = flipped

# 2. Regroupement par case puis par paquets de MAX_TRIS triangles
cells = defaultdict(list)
for o in meshes:
    vs = o.data.vertices
    if not len(vs):
        continue
    c = sum((v.co for v in vs), Vector()) / len(vs)
    cells[(math.floor(c.x / CELL), math.floor(c.y / CELL))].append(o)

groups = []
for key, objs in sorted(cells.items()):
    # objets proches les uns des autres dans le même paquet
    objs.sort(key=lambda o: (round(sum((v.co.x for v in o.data.vertices)) / len(o.data.vertices), 1), o.name))
    cur, cur_t = [], 0
    for o in objs:
        t = tris(o.data)
        if cur and cur_t + t > MAX_TRIS:
            groups.append((key, cur)); cur, cur_t = [], 0
        cur.append(o); cur_t += t
    if cur:
        groups.append((key, cur))

# 3. Jointure
merged = []
for gi, (key, objs) in enumerate(groups):
    active = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=active, object=active,
                                       selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    active.name = f"zone_{key[0]}_{key[1]}_{gi}"
    active.data.name = active.name
    merged.append(active)

# Nettoyage : objets vides devenus inutiles (on garde caméra et lumières)
for o in list(sc.objects):
    if o.type == 'EMPTY' and not o.children:
        D.objects.remove(o)

report["objects_after"] = len(merged)
report["tris_total"] = sum(tris(o.data) for o in merged)
report["max_tris_per_object"] = max(tris(o.data) for o in merged)
report["cells"] = len(cells)

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_yup=True, export_apply=True,
    export_cameras=True, export_lights=True, export_import_convert_lighting_mode='RAW',
    export_animations=True, export_materials='EXPORT', export_normals=True,
    export_texcoords=False, export_tangents=False, export_draco_mesh_compression_enable=False,
)
json.dump(report, open(REPORT, "w", encoding="utf-8"), indent=1)
print("MERGE_OK")
