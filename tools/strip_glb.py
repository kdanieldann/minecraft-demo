#!/usr/bin/env python3
"""Strip a PINOC skinned-glb down to its skeleton and animation.

PINOC's skinned-glb bundles the X Bot mesh with every clip (~1.8 MB), but the blocky rig
only reads bone transforms, so the mesh, skin, materials and textures are dead weight.
This keeps the node hierarchy (the bones, with their rest transforms) and the animations,
and drops everything else — typically ~40 KB per clip.

    python3 tools/strip_glb.py assets/characters/*.glb      # rewrites the files in place
"""
import json
import struct
import sys

DROP = ("meshes", "skins", "materials", "textures", "images", "samplers", "cameras")


def strip(path):
    data = open(path, "rb").read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2, f"{path}: not a glTF 2 binary"
    json_len, _ = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + json_len])
    off = 20 + json_len
    bin_len, _ = struct.unpack_from("<II", data, off)
    blob = data[off + 8:off + 8 + bin_len]

    for node in gltf["nodes"]:
        node.pop("mesh", None)
        node.pop("skin", None)
    for key in DROP:
        gltf.pop(key, None)

    # A channel that never changes (most bones' translation and scale) is folded into the
    # node's rest transform and dropped — lossless, and it removes most of the remaining data.
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}
    def floats(i):
        acc = gltf["accessors"][i]
        assert acc["componentType"] == 5126, "expected float animation data"
        view = gltf["bufferViews"][acc["bufferView"]]
        n = acc["count"] * width[acc["type"]]
        return struct.unpack_from(f"<{n}f", blob, view.get("byteOffset", 0) + acc.get("byteOffset", 0)), width[acc["type"]]
    for a in gltf["animations"]:
        keep = []
        for ch in a["channels"]:
            vals, w = floats(a["samplers"][ch["sampler"]]["output"])
            first = vals[:w]
            if all(abs(v - first[k % w]) < 1e-5 for k, v in enumerate(vals)):
                gltf["nodes"][ch["target"]["node"]][ch["target"]["path"]] = list(first)
            else:
                keep.append(ch)
        used_samplers = sorted({ch["sampler"] for ch in keep})
        new_index = {old: new for new, old in enumerate(used_samplers)}
        a["samplers"] = [a["samplers"][i] for i in used_samplers]
        for ch in keep:
            ch["sampler"] = new_index[ch["sampler"]]
        a["channels"] = keep

    # keep only the accessors animations read, repacked into a fresh buffer
    used = sorted({i for a in gltf["animations"] for s in a["samplers"] for i in (s["input"], s["output"])})
    remap, accessors, views, out = {}, [], [], bytearray()
    for i in used:
        acc = dict(gltf["accessors"][i])
        view = gltf["bufferViews"][acc["bufferView"]]
        start = view.get("byteOffset", 0)
        chunk = blob[start:start + view["byteLength"]]
        while len(out) % 4:
            out.append(0)
        views.append({"buffer": 0, "byteOffset": len(out), "byteLength": len(chunk)})
        out += chunk
        acc["bufferView"] = len(views) - 1
        remap[i] = len(accessors)
        accessors.append(acc)
    for a in gltf["animations"]:
        for s in a["samplers"]:
            s["input"], s["output"] = remap[s["input"]], remap[s["output"]]
    gltf["accessors"], gltf["bufferViews"] = accessors, views
    gltf["buffers"] = [{"byteLength": len(out)}]

    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out += b"\0" * (-len(out) % 4)
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out))
    glb += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(out), 0x004E4942) + bytes(out)
    open(path, "wb").write(glb)
    return len(data), len(glb)


if __name__ == "__main__":
    total = [0, 0]
    for p in sys.argv[1:]:
        before, after = strip(p)
        total[0] += before
        total[1] += after
        print(f"{p}: {before // 1024} KB -> {after // 1024} KB")
    print(f"total: {total[0] // 1024} KB -> {total[1] // 1024} KB")
