# Nettoyage de la scène du site à partir du .glb en ligne.
# Usage : blender -b --python bl_fix.py -- <in.glb> <out.blend> <out.glb> <report.json>
import bpy, bmesh, json, sys, math
from collections import defaultdict

args = sys.argv[sys.argv.index("--") + 1:]
IN_GLB, OUT_BLEND, OUT_GLB, REPORT = args[:4]

bpy.ops.wm.read_factory_settings(use_empty=True)
# L'animation caméra d'origine est échantillonnée à 30 i/s : même cadence
# ici pour que les clés retombent sur des images entières (export identique)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=IN_GLB, export_import_convert_lighting_mode='RAW')
D = bpy.data
meshes = [o for o in D.objects if o.type == 'MESH']

def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)

report = {"before_tris": sum(tri_count(o.data) for o in meshes), "objects": len(meshes)}

# ---------- 1. Un seul matériau ----------
ref = D.materials.get("01___Default.002")
other = sorted({s.material.name for o in meshes for s in o.material_slots if s.material and s.material != ref})
for o in meshes:
    if not o.material_slots:
        o.data.materials.append(ref)
    for s in o.material_slots:
        s.material = ref
for m in list(D.materials):
    if m != ref and m.users == 0:
        D.materials.remove(m)
report["materials_replaced"] = other

# ---------- 2. Géométrie : fusion, doublons, faces inversées, simplification ----------
# Objets dont la forme est organique : on accepte une simplification par effondrement
COLLAPSE_TARGETS = {  # préfixe de nom -> ratio
    "Stanford's Lucy Angel": 0.5,
    "Steltman": 0.5,
}
per_obj = []
done = set()
for o in meshes:
    me = o.data
    if me.name in done:
        continue
    done.add(me.name)
    t0 = tri_count(me)

    bm = bmesh.new()
    bm.from_mesh(me)
    # L'export glTF coupe la géométrie aux arêtes vives : on mémorise ces
    # coupures pour les remettre en arêtes vives après la fusion des sommets
    # (le lissage reste exactement celui d'origine)
    key = lambda co: (round(co.x, 4), round(co.y, 4), round(co.z, 4))
    seams = {frozenset((key(e.verts[0].co), key(e.verts[1].co))) for e in bm.edges if e.is_boundary}
    # Sommets dupliqués
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    for e in bm.edges:
        if not e.is_boundary and frozenset((key(e.verts[0].co), key(e.verts[1].co))) in seams:
            e.smooth = False
    # Faces dégénérées et sommets isolés
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    # Faces confondues (ex. jonctions internes des colonnes) : intérieures, on supprime les deux
    groups = defaultdict(list)
    for f in bm.faces:
        groups[tuple(sorted(v.index for v in f.verts))].append(f)
    bm.verts.index_update()
    groups = defaultdict(list)
    for f in bm.faces:
        groups[tuple(sorted(v.index for v in f.verts))].append(f)
    inner = [f for fs in groups.values() if len(fs) > 1 for f in fs]
    if inner:
        bmesh.ops.delete(bm, geom=inner, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    # Orientation cohérente des faces (vers l'extérieur)
    before_n = {f.index: f.normal.copy() for f in bm.faces}
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    flipped = sum(1 for f in bm.faces if f.index in before_n and f.normal.dot(before_n[f.index]) < 0)
    # Faces coplanaires fusionnées (aucun changement de forme)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), use_dissolve_boundaries=False,
                             verts=bm.verts, edges=bm.edges, delimit=set())
    bm.to_mesh(me)
    bm.free()

    # Simplification ciblée des objets organiques trop lourds
    ratio = next((r for k, r in COLLAPSE_TARGETS.items() if o.name.startswith(k)), None)
    if ratio:
        mod = o.modifiers.new("decimate", 'DECIMATE')
        mod.ratio = ratio
        bpy.context.view_layer.objects.active = o
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=mod.name)

    # Normales : recalculées à partir de la géométrie corrigée, avec le
    # lissage par face et les arêtes vives d'origine
    if me.has_custom_normals:
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    me.update()
    t1 = tri_count(me)
    # (les n-gones sont triangulés à l'export : on compte les triangles réels)
    per_obj.append({"name": o.name, "before": t0, "after": t1, "flipped": flipped, "inner_faces": len(inner),
                    "collapse": ratio})

report["after_tris"] = sum(tri_count(o.data) for o in meshes)
per_obj.sort(key=lambda r: -(r["before"] - r["after"]))
report["biggest_savings"] = per_obj[:15]
report["flipped_fixed"] = sorted([(r["name"], r["flipped"]) for r in per_obj if r["flipped"]], key=lambda x: -x[1])[:30]
report["flipped_objects"] = sum(1 for r in per_obj if r["flipped"])
report["inner_faces_removed"] = sum(r["inner_faces"] for r in per_obj)

# ---------- 2b. Animation caméra : clés avant t=0 ----------
# L'original commence à -0,4 s (caméra immobile sur ce passage). L'exporteur
# refuse les temps négatifs et décalerait toute l'animation : on retire ces clés.
removed_keys = 0
for act in D.actions:
    fcurves = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                fcurves.extend(cb.fcurves)
    for fc in fcurves:
        neg = [k for k in fc.keyframe_points if k.co.x < -1e-3]
        for k in reversed(neg):
            fc.keyframe_points.remove(k, fast=True)
            removed_keys += 1
        fc.update()
report["camera_negative_keys_removed"] = removed_keys
bpy.context.scene.frame_start = 0

# ---------- 3. Sauvegarde + export ----------
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_yup=True, export_apply=True,
    export_cameras=True, export_lights=True, export_import_convert_lighting_mode='RAW',
    export_animations=True, export_materials='EXPORT', export_normals=True,
    export_texcoords=False, export_tangents=False, export_draco_mesh_compression_enable=False,
)
json.dump(report, open(REPORT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("FIX_OK")
