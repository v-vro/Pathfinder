"""Turn a segmented CT into the web assets Pathfinder needs.

Inputs  (data/<case>/):  ct.nii.gz, case.json, seg/total.nii.gz, seg/lung_vessels.nii.gz (optional)
Outputs (web/public/cases/<case>/):
    meta.json          grids, label table, target nodule, rib points, landmarks, stats
    labels.u8.gz       analysis grid (1.5 mm): structure label per voxel
    vclear.u8.gz       clearance to nearest pulmonary vessel wall      (mm * 4, capped 63.75)
    vcal.u8.gz         calibre of that nearest vessel                  (mm * 10, capped 25.5)
    vclearL.u8.gz      clearance to nearest LARGE vessel (>= 4 mm)     (mm * 4)
    emph.u8.gz         local emphysema LAA-950 % (0-100); 200 = bulla
    lung.u8.gz         smoothed lung mask (0-255) -> pleura position + normal
    ct.i16.gz          CT in HU on a 1 mm grid (slice view)
    anatomy.glb        meshes: skin, skeleton, lobes, fissures, vessels, heart, great vessels, airway, nodule, emphysema

All coordinates are DICOM patient coordinates (LPS, mm). Volumes are z-major: idx = (k*ny + j)*nx + i.
"""
from __future__ import annotations

import argparse
import gzip
import json
import time
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import trimesh
from scipy import ndimage as ndi
from skimage import measure, morphology

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "web" / "public" / "cases"

SP = 1.5      # analysis grid spacing (mm)
CT_SP = 1.0   # slice-view grid spacing (mm)

LABELS = {
    0: "outside body",
    1: "chest wall / soft tissue",
    2: "rib",
    3: "heart",
    4: "great vessel",
    5: "trachea / oesophagus",
    6: "abdominal organ",
    7: "scapula",
    8: "spine",
    9: "sternum / clavicle / cartilage",
    10: "left upper lobe",
    11: "left lower lobe",
    12: "right upper lobe",
    13: "right middle lobe",
    14: "right lower lobe",
    15: "outside scan field of view (synthesized)",
    20: "target nodule",
}
LOBES = {
    "lung_upper_lobe_left": 10,
    "lung_lower_lobe_left": 11,
    "lung_upper_lobe_right": 12,
    "lung_middle_lobe_right": 13,
    "lung_lower_lobe_right": 14,
}
FISSURES = [
    # (name, lobe pairs)
    ("right_oblique_fissure", [(12, 14), (13, 14)]),
    ("right_horizontal_fissure", [(12, 13)]),
    ("left_oblique_fissure", [(10, 11)]),
]
BONE_PREFIX = ("rib_", "vertebrae_", "sternum", "costal_cartilages", "scapula_", "clavicula_", "humerus_")
GREAT_VESSELS = ("aorta", "pulmonary_vein", "pulmonary_artery", "superior_vena_cava", "inferior_vena_cava",
                 "brachiocephalic_trunk", "brachiocephalic_vein_left", "brachiocephalic_vein_right",
                 "subclavian_artery_left", "subclavian_artery_right", "common_carotid_artery_left",
                 "common_carotid_artery_right", "atrial_appendage_left")
AIRWAY = ("trachea", "esophagus")
ABDOMEN = ("liver", "spleen", "stomach", "kidney_left", "kidney_right", "pancreas", "gallbladder",
           "duodenum", "colon", "small_bowel", "adrenal_gland_left", "adrenal_gland_right")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------------------------------------------------------- grid helpers
def ref_image(origin, spacing, dims, pixel=sitk.sitkUInt8) -> sitk.Image:
    img = sitk.Image([int(d) for d in dims], pixel)
    img.SetOrigin([float(o) for o in origin])
    img.SetSpacing([float(spacing)] * 3)
    img.SetDirection((1, 0, 0, 0, 1, 0, 0, 0, 1))
    return img


def resample(img: sitk.Image, ref: sitk.Image, nearest: bool, default: float, out_pixel=None) -> np.ndarray:
    interp = sitk.sitkNearestNeighbor if nearest else sitk.sitkLinear
    out = sitk.Resample(img, ref, sitk.Transform(), interp, default, out_pixel or img.GetPixelID())
    return sitk.GetArrayFromImage(out)  # (z, y, x)


def world_to_index(p, origin, spacing):
    return tuple(int(round((p[a] - origin[a]) / spacing)) for a in (2, 1, 0))  # (k, j, i)


def save_u8(path: Path, arr: np.ndarray) -> None:
    with gzip.open(path, "wb", compresslevel=6) as f:
        f.write(np.ascontiguousarray(arr).tobytes())


# ----------------------------------------------------------------------------- meshes
def mask_to_mesh(mask: np.ndarray, origin, spacing: float, sigma: float, faces: int,
                 level: float = 0.5) -> trimesh.Trimesh | None:
    if mask.sum() < 8:
        return None
    zz, yy, xx = np.nonzero(mask)
    lo = np.maximum([zz.min() - 3, yy.min() - 3, xx.min() - 3], 0)
    hi = np.minimum([zz.max() + 4, yy.max() + 4, xx.max() + 4], mask.shape)
    sub = mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    f = np.pad(sub.astype(np.float32), 1)
    if sigma > 0:
        f = ndi.gaussian_filter(f, sigma)
    if f.max() < level:
        return None
    v, fc, _, _ = measure.marching_cubes(f, level=level, spacing=(spacing,) * 3)
    v = v - spacing  # undo the pad
    v += np.array(lo) * spacing
    v = v[:, ::-1] + np.asarray(origin)  # (z,y,x) -> (x,y,z) LPS
    # (no winding flip needed: verified outward-facing via positive signed volume)
    m = trimesh.Trimesh(v, fc, process=True)
    if len(m.faces) > faces:
        try:
            m = m.simplify_quadric_decimation(face_count=faces)
        except Exception as e:  # pragma: no cover
            log(f"  decimation failed ({e}); keeping {len(m.faces)} faces")
    trimesh.smoothing.filter_taubin(m, iterations=6)
    return m


# ----------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case-id", default="lidc-0742")
    args = ap.parse_args()

    case = DATA / args.case_id
    out = OUT / args.case_id
    out.mkdir(parents=True, exist_ok=True)
    meta_in = json.loads((case / "case.json").read_text())
    nod = meta_in["nodules_lps"][0]
    nod_c = np.array([nod["x"], nod["y"], nod["z"]], float)
    nod_d = float(nod["d"])

    log("loading CT")
    ct = sitk.ReadImage(str(case / "ct.nii.gz"), sitk.sitkInt16)
    ct = sitk.Maximum(ct, -1024)  # outside-FOV padding (-3024) -> air

    from totalsegmentator.map_to_binary import class_map  # local import: heavy
    names_total = class_map["total"]
    total_path = case / "seg" / "total_full.nii.gz"
    if not total_path.exists():
        total_path = case / "seg" / "total.nii.gz"
    log(f"segmentation: {total_path.name}")
    seg_total = sitk.ReadImage(str(total_path), sitk.sitkUInt8)

    # ---- crop bounds from a coarse pass (body bbox in x/y, lungs +- margin in z)
    log("computing crop")
    sz, sp0, org0 = np.array(ct.GetSize()), np.array(ct.GetSpacing()), np.array(ct.GetOrigin())
    scan_lo, scan_hi = org0, org0 + (sz - 1) * sp0
    coarse = ref_image(scan_lo, 3.0, np.floor((scan_hi - scan_lo) / 3.0) + 1)
    c_ct = resample(ct, coarse, False, -1024)
    c_body = largest_cc(ndi.binary_opening(c_ct > -500, iterations=1))
    c_seg = resample(seg_total, coarse, True, 0)
    lung_ids = [k for k, v in names_total.items() if v in LOBES]
    c_lung = np.isin(c_seg, lung_ids)
    zb, yb, xb = np.nonzero(c_body)
    zl = np.nonzero(c_lung)[0]
    lo = np.array([xb.min(), yb.min(), zl.min()]) * 3.0 + scan_lo - np.array([6, 6, 25])
    hi = np.array([xb.max(), yb.max(), zl.max()]) * 3.0 + scan_lo + np.array([6, 6, 25])
    # x/y may extend past the scan: the scanner's field of view sometimes cuts the patient's flank,
    # and we synthesize that part by mirroring (labelled "outside scan" so it is never planned through).
    lo[:2] -= 24
    hi[:2] += 24
    lo = np.maximum(lo, scan_lo - np.array([30, 30, 0]))
    hi = np.minimum(hi, scan_hi + np.array([30, 30, 0]))
    dims = np.floor((hi - lo) / SP).astype(int) + 1
    log(f"  crop {lo.round(1)} -> {hi.round(1)}  analysis dims {dims}")

    grid = ref_image(lo, SP, dims)
    hu = resample(ct, grid, False, -1024).astype(np.int16)
    seg = resample(seg_total, grid, True, 0)
    origin = lo

    def ids(pred):
        return [k for k, v in names_total.items() if pred(v)]

    # ---- body
    log("body mask")
    raw = sitk.ReadImage(str(case / "ct.nii.gz"), sitk.sitkInt16)
    valid = resample(raw, grid, True, -3024) > -2000  # inside the reconstructed field of view
    del raw
    P = 3  # edge-replicate in z so morphology doesn't erode the first/last slices
    zpad = lambda a: np.pad(a, ((P, P), (0, 0), (0, 0)), mode="edge")
    body = largest_cc(ndi.binary_opening(zpad(hu > -500), iterations=2))[P:-P]
    body = np.stack([ndi.binary_fill_holes(s) for s in body])
    body = ndi.binary_closing(zpad(body), iterations=2)[P:-P]

    vz = np.nonzero(np.isin(seg, ids(lambda n: n.startswith("vertebrae_"))))
    mid_x = float(np.median(vz[2]) * SP + origin[0]) if vz[0].size else float(origin[0] + dims[0] * SP / 2)
    xs_ = origin[0] + np.arange(dims[0]) * SP
    im = np.round((2 * mid_x - xs_ - origin[0]) / SP).astype(int)
    okm = (im >= 0) & (im < dims[0])
    mirrored = np.zeros_like(body)
    mirrored[:, :, okm] = body[:, :, im[okm]]
    synth = ~valid & mirrored & ~body
    body |= synth
    log(f"  synthesized {synth.sum() * SP ** 3 / 1000:.0f} ml of body outside the scan field of view (mirrored)")

    labels = np.zeros(hu.shape, np.uint8)
    labels[body] = 1
    labels[synth] = 15

    groups = [
        (6, ids(lambda n: n in ABDOMEN)),
        (5, ids(lambda n: n in AIRWAY)),
        (3, ids(lambda n: n.startswith("heart"))),
        (4, ids(lambda n: n in GREAT_VESSELS)),
        (9, ids(lambda n: n.startswith(("sternum", "costal_cartilages", "clavicula_", "humerus_")))),
        (8, ids(lambda n: n.startswith("vertebrae_"))),
        (7, ids(lambda n: n.startswith("scapula_"))),
        (2, ids(lambda n: n.startswith("rib_"))),
    ]
    # Segmentation gives identity; the CT gives crisp edges (the fast 3 mm model is terraced).
    hu_s = ndi.gaussian_filter(hu.astype(np.float32), 0.7)
    for lab, idl in groups:
        m = np.isin(seg, idl) & body
        if lab in (2, 7, 8, 9):  # bone: segmentation + 3 mm margin, cut to bone density
            m = ndi.binary_fill_holes(ndi.binary_dilation(m, iterations=2) & (hu_s > 160)) & body
        labels[m] = lab

    log("lungs (HU-refined lobes)")
    lobe_lab = np.zeros(hu.shape, np.uint8)
    for name, lab in LOBES.items():
        lobe_lab[np.isin(seg, [i for i, v in names_total.items() if v == name])] = lab
    seg_lung = lobe_lab > 0
    trachea = np.isin(seg, ids(lambda n: n == "trachea"))
    lung_ref = (ndi.binary_dilation(seg_lung, iterations=3) & (hu_s < -400) & body) | ndi.binary_erosion(seg_lung, iterations=2)
    lung_ref &= ~ndi.binary_dilation(trachea, iterations=1)
    lung_ref = ndi.binary_closing(lung_ref, iterations=1) & body & ~np.isin(labels, [2, 3, 4, 5, 6, 7, 8, 9])
    _, ind = ndi.distance_transform_edt(~seg_lung, return_indices=True)
    lobe_ref = np.where(lung_ref, lobe_lab[ind[0], ind[1], ind[2]], 0).astype(np.uint8)
    del ind
    lobe_masks = {}
    for name, lab in LOBES.items():
        m = lobe_ref == lab
        lobe_masks[lab] = m
        labels[m] = lab
    lung_any = lobe_ref > 0

    # ---- nodule (region grow around the annotated centre)
    log("nodule")
    kk, jj, ii = np.indices(hu.shape, sparse=True)
    pz, py, px = origin[2] + kk * SP, origin[1] + jj * SP, origin[0] + ii * SP
    r2 = (px - nod_c[0]) ** 2 + (py - nod_c[1]) ** 2 + (pz - nod_c[2]) ** 2
    sphere_lim = r2 <= (nod_d / 2 * 1.25) ** 2
    cand = sphere_lim & (hu > -650)
    lab_cc, _ = ndi.label(cand)
    ck = world_to_index(nod_c, origin, SP)
    win = lab_cc[max(ck[0] - 2, 0):ck[0] + 3, max(ck[1] - 2, 0):ck[1] + 3, max(ck[2] - 2, 0):ck[2] + 3]
    vals = win[win > 0]
    nodule = (lab_cc == np.bincount(vals).argmax()) if vals.size else np.zeros_like(cand)
    nodule = ndi.binary_opening(nodule, iterations=1) | (r2 <= (nod_d / 2 * 0.5) ** 2)
    expected = 4 / 3 * np.pi * (nod_d / 2) ** 3 / SP ** 3
    if nodule.sum() < 0.3 * expected:
        log("  region grow too small -> sphere fallback")
        nodule = r2 <= (nod_d / 2) ** 2
    nodule &= body
    near = ndi.binary_dilation(nodule, iterations=2)
    lobe_votes = {lab: int((m & near).sum()) for lab, m in lobe_masks.items()}
    nodule_lobe = max(lobe_votes, key=lobe_votes.get)
    lung_any |= nodule
    labels[nodule] = 20
    log(f"  nodule voxels={int(nodule.sum())} (~{nodule.sum() * SP ** 3 / 1000:.2f} ml), lobe={LABELS[nodule_lobe]}")

    # ---- pulmonary vessels
    log("vessels")
    vfile = case / "seg" / "lung_vessels.nii.gz"
    if vfile.exists():
        # classes: 1 lung_airways, 2 lung_airways_wall, 3 lung_arteries, 4 lung_veins
        vs = resample(sitk.ReadImage(str(vfile), sitk.sitkUInt8), grid, True, 0)
        arteries, veins = (vs == 3), (vs == 4)
        vessels = arteries | veins
        bronchi = (vs == 1) | (vs == 2)
        vessel_source = "TotalSegmentator lung_vessels (arteries + veins)"
    else:
        sm = ndi.gaussian_filter(hu.astype(np.float32), 0.6)
        vessels = ndi.binary_erosion(lung_any, iterations=1) & (sm > -500)
        arteries, veins = vessels, np.zeros_like(vessels)
        bronchi = np.zeros_like(vessels)
        vessel_source = "HU threshold (> -500 HU inside lung)"
    vessels &= ~ndi.binary_dilation(nodule, iterations=1)
    vessels = morphology.remove_small_objects(vessels, max_size=19)
    vclear, vcal, vclear_large = vessel_fields(vessels)

    # ---- emphysema (LAA-950 fraction from native resolution)
    log("emphysema")
    low = sitk.Cast(sitk.BinaryThreshold(ct, -1023, -950, 1, 0), sitk.sitkFloat32)
    frac = resample(low, grid, False, 0.0, sitk.sitkFloat32)
    parench = lung_any & ~vessels & ~nodule & ~ndi.binary_dilation(bronchi | trachea, iterations=1)  # airway lumens are air, not emphysema
    frac = np.where(parench, frac, 0.0)
    local = ndi.uniform_filter(frac, 5) / np.maximum(ndi.uniform_filter(parench.astype(np.float32), 5), 1e-3)
    emph_pct = np.clip(np.where(parench, local * 100, 0), 0, 100).astype(np.uint8)
    lab_b, nb = ndi.label((frac > 0.5) & parench)
    bulla = np.zeros_like(parench)
    if nb:
        sizes = ndi.sum(np.ones_like(lab_b), lab_b, range(1, nb + 1)) * SP ** 3
        big = np.nonzero(sizes >= 1000)[0] + 1  # >= 1 cm^3 contiguous air space
        bulla = np.isin(lab_b, big)
    emph = emph_pct.copy()
    emph[bulla] = 200
    laa_total = float(frac[parench].mean() * 100) if parench.any() else 0.0
    log(f"  whole-lung LAA-950 = {laa_total:.1f}%, bullae voxels={int(bulla.sum())}")

    # ---- smooth lung field (pleura)
    lung_s = (np.clip(ndi.gaussian_filter(lung_any.astype(np.float32), 1.0), 0, 1) * 255).astype(np.uint8)

    # ---- write volumes
    log("writing volumes")
    save_u8(out / "labels.u8.gz", labels)
    save_u8(out / "vclear.u8.gz", vclear)
    save_u8(out / "vcal.u8.gz", vcal)
    save_u8(out / "vclearL.u8.gz", vclear_large)
    save_u8(out / "emph.u8.gz", emph)
    save_u8(out / "lung.u8.gz", lung_s)
    vsl = np.zeros(body.shape, np.uint8)
    vsl[(vs == 1) if vfile.exists() else np.zeros_like(body)] = 3
    vsl[veins & vessels] = 2
    vsl[arteries & vessels] = 1
    save_u8(out / "vsl.u8.gz", vsl)
    fis_major = np.zeros_like(body)
    fis_minor = np.zeros_like(body)
    for fname, pairs in FISSURES:
        for a, b in pairs:
            ma, mb = lobe_masks[a], lobe_masks[b]
            band = (ndi.binary_dilation(ma, iterations=1) & mb) | (ndi.binary_dilation(mb, iterations=1) & ma)
            if fname == "right_horizontal_fissure":
                fis_minor |= band
            else:
                fis_major |= band
    for fname_, band in (("fmaj.u8.gz", fis_major), ("fmin.u8.gz", fis_minor)):
        dist_ = ndi.distance_transform_edt(~band) * SP if band.any() else np.full(band.shape, 99.0)
        save_u8(out / fname_, np.clip(dist_ * 4, 0, 255).astype(np.uint8))
    ct_dims = np.floor((hi - lo) / CT_SP).astype(int) + 1
    ct_grid = ref_image(lo, CT_SP, ct_dims, sitk.sitkInt16)
    ct1 = resample(ct, ct_grid, False, -1024).astype(np.int16)
    with gzip.open(out / "ct.i16.gz", "wb", compresslevel=6) as f:
        f.write(np.ascontiguousarray(ct1).astype("<i2").tobytes())

    # ---- centrelines (vessels + airways): drawn as light lines, turned into true-calibre tubes near the needle
    log("centrelines")
    airway_lumen = (vs == 1) if vfile.exists() else np.zeros_like(body)
    line_sets = [(0, arteries & vessels), (1, veins & vessels), (2, airway_lumen | trachea)]
    pts_all, branches = [], []
    for kind, mask in line_sets:
        if not mask.any():
            continue
        pts, br = trace_centerlines(mask, origin, SP)
        base = sum(len(p) for p in pts_all)
        pts_all.append(pts)
        branches += [[kind, base + s, c] for s, c in br]
        log(f"  kind {kind}: {len(br)} branches, {len(pts)} points")
    lines = np.concatenate(pts_all).astype("<f4") if pts_all else np.zeros((0, 5), "<f4")
    with gzip.open(out / "lines.f32.gz", "wb", compresslevel=6) as f:
        f.write(lines.tobytes())
    (out / "lines.json").write_text(json.dumps({"stride": 5, "fields": ["x", "y", "z", "radiusMm", "flowMm"],
                                                "kinds": ["artery", "vein", "airway"], "branches": branches}))

    # ---- meshes
    log("meshes")
    scene = trimesh.Scene()

    log("1 mm mesh grid")
    seg1 = resample(seg_total, ct_grid, True, 0)
    hu1s = ndi.gaussian_filter(ct1.astype(np.float32), 0.6)
    body1 = resample(_arr_img(body, origin, SP), ct_grid, True, 0) > 0
    def bone1(pred):
        m = np.isin(seg1, ids(pred))
        return ndi.binary_fill_holes(ndi.binary_dilation(m, iterations=2) & (hu1s > 160)) & body1
    if vfile.exists():
        vs1 = resample(sitk.ReadImage(str(vfile), sitk.sitkUInt8), ct_grid, True, 0)
        art1, vein1 = vs1 == 3, vs1 == 4
    else:
        art1 = vein1 = None

    def add(name, mask, sigma, faces, level=0.5, post=None, sp=SP):
        m = mask_to_mesh(mask, origin, sp, sigma, faces, level)
        if m is not None and post is not None:
            m = post(m)
        if m is not None:
            scene.add_geometry(m, node_name=name, geom_name=name)
            log(f"  {name}: {len(m.faces)} faces")

    add("skin", body, 1.5, 70000, post=open_caps)
    add("ribs", bone1(lambda n: n.startswith(("rib_", "sternum", "costal_cartilages", "clavicula_"))), 1.0, 180000, sp=CT_SP)
    add("scapulae", bone1(lambda n: n.startswith("scapula_")), 1.0, 50000, sp=CT_SP)
    add("spine", bone1(lambda n: n.startswith("vertebrae_")), 1.0, 100000, sp=CT_SP)
    for name, lab in LOBES.items():
        add(name, lobe_masks[lab], 1.2, 40000)
    for fname, pairs in FISSURES:
        band = np.zeros_like(body)
        for a, b in pairs:
            ma, mb = lobe_masks[a], lobe_masks[b]
            band |= (ndi.binary_dilation(ma, iterations=1) & mb) | (ndi.binary_dilation(mb, iterations=1) & ma)
        add(fname, band, 1.3, 30000, level=0.3)
    flow_by_kind = {}
    for kind, start, count in branches:
        flow_by_kind.setdefault(kind, []).append(lines[start:start + count])
    if art1 is not None:
        add("arteries", art1, 0.8, 140000, sp=CT_SP, post=lambda m: attach_flow(m, flow_by_kind.get(0)))
        add("veins", vein1, 0.8, 140000, sp=CT_SP, post=lambda m: attach_flow(m, flow_by_kind.get(1)))
    else:
        add("arteries", arteries & vessels, 0.6, 100000, post=lambda m: attach_flow(m, flow_by_kind.get(0)))
    if bronchi.any():
        add("airways", bronchi | np.isin(seg, ids(lambda n: n == "trachea")), 0.7, 60000, post=lambda m: attach_flow(m, flow_by_kind.get(2)))
    add("heart", np.isin(seg1, ids(lambda n: n.startswith("heart"))), 2.2, 50000, sp=CT_SP)
    add("great_vessels", np.isin(seg1, ids(lambda n: n in GREAT_VESSELS)), 1.8, 60000, sp=CT_SP)
    add("nodule", nodule, 0.9, 8000)
    if (emph_pct >= 15).sum() > 50:
        add("emphysema", (emph_pct >= 15) | bulla, 1.0, 40000)

    log("full-body shell")
    human = ROOT / "web" / "public" / "models" / "body" / "human.glb"
    if human.exists():
        shell, body_info = fit_human_model(human, body, origin, SP, mid_x)
    else:
        shell, body_info = build_body_shell(body, origin, SP, mid_x)
    scene.add_geometry(shell, node_name="body", geom_name="body")
    log(f"  body: {len(shell.faces)} faces, floor z={body_info['floorZ']:.0f}, head top z={body_info['headTopZ']:.0f}")
    scene.export(str(out / "anatomy.glb"), file_type="glb")


    # ---- ribs (for intercostal-space naming) + landmarks
    log("ribs + landmarks")
    ribs = {}
    rng = np.random.default_rng(0)
    for k, v in names_total.items():
        if v.startswith("rib_"):
            pts = np.argwhere(seg == k)
            if len(pts) == 0:
                continue
            if len(pts) > 160:
                pts = pts[rng.choice(len(pts), 160, replace=False)]
            xyz = pts[:, ::-1] * SP + origin
            side, num = v.split("_")[1], int(v.split("_")[2])
            ribs[f"{side[0].upper()}{num}"] = np.round(xyz, 1).tolist()
    vert = np.isin(seg, ids(lambda n: n.startswith("vertebrae_")))
    vz = np.nonzero(vert)
    midline_x = float(np.median(vz[2]) * SP + origin[0]) if vz[0].size else float(nod_c[0] * 0)
    spine_post_y = float(np.percentile(vz[1], 98) * SP + origin[1]) if vz[0].size else None
    stern = np.nonzero(np.isin(seg, ids(lambda n: n == "sternum")))
    sternum_y = float(np.percentile(stern[1], 2) * SP + origin[1]) if stern[0].size else None

    lung_dist = ndi.distance_transform_edt(lung_any) * SP
    nod_pleura = float(lung_dist[ndi.binary_erosion(nodule) ^ nodule].min()) if nodule.any() else None
    nz = np.argwhere(nodule)
    nod_centroid = (nz[:, ::-1].mean(0) * SP + origin).tolist()
    nod_hu = float(hu[nodule].mean())

    meta = {
        "caseId": args.case_id,
        "source": meta_in.get("source"),
        "series": meta_in.get("series"),
        "frame": "DICOM LPS, millimetres (+x patient left, +y posterior, +z superior)",
        "grid": {"origin": origin.round(3).tolist(), "spacing": SP, "dims": dims.tolist()},
        "ctGrid": {"origin": origin.round(3).tolist(), "spacing": CT_SP, "dims": ct_dims.tolist()},
        "files": {"labels": "labels.u8.gz", "vclear": "vclear.u8.gz", "vcal": "vcal.u8.gz",
                  "vclearL": "vclearL.u8.gz", "emph": "emph.u8.gz", "lung": "lung.u8.gz",
                  "ct": "ct.i16.gz", "anatomy": "anatomy.glb", "lines": "lines.f32.gz", "linesIndex": "lines.json",
                  "fmaj": "fmaj.u8.gz", "fmin": "fmin.u8.gz", "vsl": "vsl.u8.gz"},
        "body": body_info,
        "encoding": {"vclear": "mm*4", "vcal": "mm*10", "vclearL": "mm*4", "fmaj": "mm*4 to predicted major fissure", "fmin": "mm*4 to predicted minor fissure", "emph": "LAA-950 % (200=bulla)",
                     "lung": "0-255 smoothed mask"},
        "labels": {str(k): v for k, v in LABELS.items()},
        "target": {
            "center": [round(float(c), 2) for c in nod_c],
            "centroid": [round(float(c), 2) for c in nod_centroid],
            "diameterMm": round(nod_d, 1),
            "volumeMl": round(float(nodule.sum() * SP ** 3 / 1000), 2),
            "meanHU": round(nod_hu, 0),
            "lobe": LABELS[nodule_lobe],
            "lobeLabel": int(nodule_lobe),
            "pleuraDistanceMm": round(nod_pleura, 1) if nod_pleura is not None else None,
        },
        "landmarks": {"midlineX": round(midline_x, 1), "spinePosteriorY": spine_post_y,
                      "sternumAnteriorY": sternum_y},
        "ribs": ribs,
        "scan": scan_info(case, ct),
        "summary": {
            "ribsFound": sorted({v for v in names_total.values() if v.startswith("rib_") and (seg == [k for k, n in names_total.items() if n == v][0]).any()}),
            "vertebraeFound": sorted({v.split("_")[1] for v in names_total.values() if v.startswith("vertebrae_") and (seg == [k for k, n in names_total.items() if n == v][0]).any()}),
            "heartMl": round(float((labels == 3).sum() * SP ** 3 / 1000), 0),
            "arteriesMl": round(float((arteries & vessels).sum() * SP ** 3 / 1000), 1),
            "veinsMl": round(float((veins & vessels).sum() * SP ** 3 / 1000), 1),
            "airwayMl": round(float(((vs == 1) if vfile.exists() else np.zeros(1)).sum() * SP ** 3 / 1000), 1),
            "branches": {k: sum(1 for b in branches if b[0] == i) for i, k in enumerate(["arteries", "veins", "airways"])},
            "synthesizedMl": round(float(synth.sum() * SP ** 3 / 1000), 0),
            "bodyLitres": round(float(body.sum() * SP ** 3 / 1e6), 1),
        },
        "stats": {
            "laa950Pct": round(laa_total, 2),
            "bullaVolumeMl": round(float(bulla.sum() * SP ** 3 / 1000), 2),
            "lobeVolumesMl": {LABELS[lab]: round(float(m.sum() * SP ** 3 / 1000), 0) for lab, m in lobe_masks.items()},
            "vesselSource": vessel_source,
            "segmentation": "TotalSegmentator (Wasserthal et al., Radiol AI 2023)",
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    log(f"done -> {out}")


def attach_flow(m: trimesh.Trimesh, chunks) -> trimesh.Trimesh:
    """Per-vertex distance-along-the-tree (from the nearest centreline point), stored in the vertex colour:
    R,G = flow mm as 16-bit (R high byte), B = 255 if unknown. Used to send light along the real vessel surface."""
    from scipy.spatial import cKDTree

    col = np.zeros((len(m.vertices), 4), np.uint8)
    col[:, 3] = 255
    if chunks:
        pts = np.concatenate(chunks)
        _, idx = cKDTree(pts[:, :3]).query(m.vertices, k=1)
        f = pts[idx, 4]
        q = np.clip(np.round(np.maximum(f, 0) * 10), 0, 65535).astype(np.uint32)  # 0.1 mm units
        col[:, 0], col[:, 1] = q >> 8, q & 255
        col[:, 2] = np.where(f < 0, 255, 0)
    m.visual.vertex_colors = col
    return m


def _arr_img(arr: np.ndarray, origin, sp: float) -> sitk.Image:
    img = sitk.GetImageFromArray(arr.astype(np.uint8))
    img.SetOrigin([float(o) for o in origin])
    img.SetSpacing([float(sp)] * 3)
    return img


def scan_info(case: Path, ct: sitk.Image) -> dict:
    info = {"size": list(ct.GetSize()), "spacingMm": [round(s, 3) for s in ct.GetSpacing()]}
    try:
        import pydicom

        f = next((case / "dicom").glob("*"), None)
        if f:
            d = pydicom.dcmread(str(f), stop_before_pixels=True)
            for k in ("Manufacturer", "ManufacturerModelName", "SliceThickness", "KVP", "ReconstructionDiameter", "ConvolutionKernel"):
                v = getattr(d, k, None)
                if v not in (None, ""):
                    info[k[0].lower() + k[1:]] = str(v)
    except Exception as e:  # pragma: no cover
        info["dicomError"] = str(e)
    return info


def open_caps(m: trimesh.Trimesh) -> trimesh.Trimesh:
    """Remove the flat lids where the scan was cut, so the torso joins the full-body shell."""
    c = m.triangles_center
    zmin, zmax = m.bounds[0][2], m.bounds[1][2]
    flat = np.abs(m.face_normals[:, 2]) > 0.8
    cap = flat & ((c[:, 2] < zmin + 3.5) | (c[:, 2] > zmax - 3.5))
    m.update_faces(~cap)
    m.remove_unreferenced_vertices()
    return m


def trace_centerlines(mask: np.ndarray, origin, sp: float):
    """Skeletonize a tubular mask and split it into branches (junction/endpoint to junction/endpoint).
    Returns points (x, y, z, radius_mm, flow_mm) and branches [(start, count)]. flow_mm is the geodesic
    distance from the tree's widest part (the hilum), used to animate light travelling along the tree."""
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra

    edt = ndi.distance_transform_edt(mask)
    skel = morphology.skeletonize(mask) > 0
    pts = np.argwhere(skel)
    n = len(pts)
    if n < 2:
        return np.zeros((0, 5)), []
    idx = -np.ones(mask.shape, np.int64)
    idx[tuple(pts.T)] = np.arange(n)
    shape = np.array(mask.shape)
    rows, cols, wts = [], [], []
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for c in (-1, 0, 1):
                if a == b == c == 0:
                    continue
                q = pts + (a, b, c)
                ok = np.all((q >= 0) & (q < shape), 1)
                j = np.full(n, -1)
                j[ok] = idx[tuple(q[ok].T)]
                m = j >= 0
                rows.append(np.nonzero(m)[0])
                cols.append(j[m])
                wts.append(np.full(m.sum(), np.sqrt(a * a + b * b + c * c) * sp))
    rows, cols, wts = np.concatenate(rows), np.concatenate(cols), np.concatenate(wts)
    G = csr_matrix((wts, (rows, cols)), shape=(n, n))
    deg = np.diff(G.indptr)
    radius = np.maximum(0.5, (edt[tuple(pts.T)] - 0.5) * sp)

    # flow distance from the widest part of each connected tree
    roots = np.nonzero(radius >= np.percentile(radius, 99.5))[0]
    flow = dijkstra(G, indices=roots, min_only=True) if len(roots) else np.full(n, np.inf)
    flow = np.where(np.isfinite(flow), flow, -1.0)

    nbrs = [G.indices[G.indptr[i]:G.indptr[i + 1]] for i in range(n)]
    seen = set()
    branches_idx = []
    starts = [i for i in range(n) if deg[i] != 2] or [0]
    for s in starts:
        for nb in nbrs[s]:
            e = (min(s, nb), max(s, nb))
            if e in seen:
                continue
            seen.add(e)
            path, prev, cur = [s, nb], s, nb
            while deg[cur] == 2:
                a, b = nbrs[cur]
                nxt = b if a == prev else a
                e = (min(cur, nxt), max(cur, nxt))
                if e in seen:
                    break
                seen.add(e)
                path.append(nxt)
                prev, cur = cur, nxt
            branches_idx.append(path)
    out_pts, out_br = [], []
    total = 0
    for path in branches_idx:
        p = np.array(path)
        xyz = pts[p][:, ::-1] * sp + np.asarray(origin)
        if len(p) >= 3:  # light smoothing, then keep every other point
            sm = xyz.copy()
            sm[1:-1] = (xyz[:-2] + 2 * xyz[1:-1] + xyz[2:]) / 4
            keep = np.r_[0, np.arange(2, len(p) - 1, 2), len(p) - 1]
            xyz, p = sm[keep], p[keep]
        rec = np.column_stack([xyz, radius[p], flow[p]])
        out_pts.append(rec)
        out_br.append((total, len(rec)))
        total += len(rec)
    return np.concatenate(out_pts), out_br


def _smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k / 4


def fit_human_model(path: Path, body: np.ndarray, origin, sp: float, mid_x: float):
    """Place a realistic CC0 human body (MakeHuman base mesh) around the patient: shoulders at the scan's
    top, torso width/depth matched to the CT body at mid-chest. The CT anatomy is shown through a window."""
    origin = np.asarray(origin, float)
    m = trimesh.load(str(path), force="mesh")
    v = np.asarray(m.vertices, float) * 100.0  # decimetres -> mm
    # model: +X model's left, +Y up, +Z front  ->  LPS: +x left, +y posterior, +z superior
    v = np.column_stack([v[:, 0], -v[:, 2], v[:, 1]])
    m = trimesh.Trimesh(v, m.faces, process=False)

    ks = np.nonzero(body.any((1, 2)))[0]
    zt = origin[2] + ks.max() * sp
    zb = origin[2] + ks.min() * sp
    stature = v[:, 2].max() - v[:, 2].min()
    floor_m = v[:, 2].min()
    shoulder_m = floor_m + 0.818 * stature  # acromion height ~ 81.8 % of stature (anthropometric average)
    shoulder_ct = zt + 15

    def torso_section(mesh, z):
        vv = np.asarray(mesh.vertices)
        slab = vv[np.abs(vv[:, 2] - z) < 12]
        if len(slab) < 20:
            return None
        bins = np.floor(slab[:, 0] / 14).astype(int)
        occ = set(bins.tolist())
        c0 = int(np.floor(np.median(slab[:, 0]) / 14))
        lo_, hi_ = c0, c0
        while lo_ - 1 in occ:
            lo_ -= 1
        while hi_ + 1 in occ:
            hi_ += 1
        t = slab[(bins >= lo_) & (bins <= hi_)]  # central contiguous cluster = torso (arms are separated by gaps)
        return np.ptp(t[:, 0]), np.ptp(t[:, 1]), (t[:, 0].max() + t[:, 0].min()) / 2, (t[:, 1].max() + t[:, 1].min()) / 2

    z_mid_ct = (zb + zt) / 2
    k = int(round((z_mid_ct - origin[2]) / sp))
    ys, xs = np.nonzero(body[k])
    W_ct, D_ct = (xs.max() - xs.min()) * sp, (ys.max() - ys.min()) * sp
    cy_ct = origin[1] + (ys.max() + ys.min()) / 2 * sp

    sz = 1.0
    for _ in range(2):  # height scale depends on where we measure, iterate once
        z_model = shoulder_m - (shoulder_ct - z_mid_ct) / sz
        sec = torso_section(m, z_model)
        if sec is None:
            break
        W_m, D_m, cx_m, cy_m = sec
        sx, sy = W_ct / W_m, D_ct / D_m
        sz = float(np.clip((sx + sy) / 2, 0.9, 1.06))  # keep a realistic stature; width/depth fitted separately
    x = (v[:, 0] - cx_m) * sx + mid_x
    y = (v[:, 1] - cy_m) * sy + cy_ct
    z = (v[:, 2] - shoulder_m) * sz + shoulder_ct
    out = trimesh.Trimesh(np.column_stack([x, y, z]), m.faces, process=True)
    if out.volume < 0:
        out.invert()
    info = {"floorZ": round(float(z.min()), 1), "headTopZ": round(float(z.max()), 1), "shoulderZ": round(float(shoulder_ct), 1),
            "torsoZ": [round(float(zb), 1), round(float(zt), 1)], "midlineX": round(mid_x, 1),
            "model": "MakeHuman base mesh (CC0)", "fit": {"sx": round(sx, 3), "sy": round(sy, 3), "sz": round(sz, 3)}}
    return out, info


def build_body_shell(body: np.ndarray, origin, sp: float, mid_x: float, G: float = 4.0):
    """Stylised full body (head, neck, shoulders, arms, pelvis, legs) built as a signed-distance field that
    blends seamlessly into the real CT torso. Returns the shell mesh WITHOUT the real-torso part (the
    interactive skin mesh covers that) plus key heights for the viewer."""
    from scipy.ndimage import map_coordinates

    origin = np.asarray(origin, float)
    ks = np.nonzero(body.any((1, 2)))[0]
    k0, k1 = ks.min(), ks.max()
    zb, zt = origin[2] + k0 * sp, origin[2] + k1 * sp

    def section(k):
        ys, xs = np.nonzero(body[k])
        return origin[0] + xs.min() * sp, origin[0] + xs.max() * sp, origin[1] + ys.min() * sp, origin[1] + ys.max() * sp

    xt0, xt1, yt0, yt1 = section(k1)
    xb0, xb1, yb0, yb1 = section(k0)
    W = max(section(k)[1] - section(k)[0] for k in range(k0, k1 + 1, 4))
    kf = float(np.clip(W / 365, 0.85, 1.15))  # proportions of a ~1.75 m adult, scaled by chest breadth
    cx, cyt, cyb = mid_x, (yt0 + yt1) / 2, (yb0 + yb1) / 2
    zsh = zt + 15 * kf  # shoulder line
    zf = zsh - 1440 * kf  # floor
    zw, zh, zcr = zsh - 390 * kf, zsh - 520 * kf, zsh - 640 * kf  # waist, hips, crotch

    def sdf2d(sl):
        return (ndi.distance_transform_edt(~sl) - ndi.distance_transform_edt(sl)) * sp

    S_top, S_bot = sdf2d(body[k1]), sdf2d(body[k0])
    S3 = ((ndi.distance_transform_edt(~body) - ndi.distance_transform_edt(body)) * sp).astype(np.float32)

    xs = np.arange(cx - W / 2 - 240 * kf, cx + W / 2 + 240 * kf, G, dtype=np.float32)
    ys = np.arange(min(yb0, yt0) - 170 * kf, max(yb1, yt1) + 70 * kf, G, dtype=np.float32)
    zs = np.arange(zf - 12, zsh + 345 * kf, G, dtype=np.float32)
    Z, Y, X = np.meshgrid(zs, ys, xs, indexing="ij")

    def sample2d(S, x, y):
        ix, iy = (x - origin[0]) / sp, (y - origin[1]) / sp
        v = map_coordinates(S, [iy.ravel(), ix.ravel()], order=1, mode="nearest").reshape(x.shape)
        ox = np.maximum(0, np.maximum(-ix, ix - (S.shape[1] - 1))) * sp
        oy = np.maximum(0, np.maximum(-iy, iy - (S.shape[0] - 1))) * sp
        return v + np.hypot(ox, oy)

    X2, Y2 = X[0], Y[0]
    top2, bot2 = sample2d(S_top, X2, Y2), sample2d(S_bot, X2, Y2)
    F = np.full(X.shape, 1e3, np.float32)

    # torso: real CT inside the scanned range, extrapolated above (shoulder roof) and below (abdomen -> pelvis)
    for i, z in enumerate(zs):
        if zb <= z <= zt:
            kz = (z - origin[2]) / sp
            ix, iy = (X2 - origin[0]) / sp, (Y2 - origin[1]) / sp
            v = map_coordinates(S3, [np.full(ix.size, kz), iy.ravel(), ix.ravel()], order=1, mode="nearest").reshape(X2.shape)
            F[i] = v
        elif z > zt:
            roof = (z - zt) - np.maximum(4, 70 * kf - 0.40 * np.abs(X2 - cx))
            F[i] = np.maximum(top2, roof)
        else:
            t = np.clip((zb - z) / 90, 0, 1)
            w = t * t * (3 - 2 * t)
            fr = np.interp(z, [zcr, zh, zw, zb], [0.80, 0.98, 0.86, 1.0])
            ax, ay = fr * (xb1 - xb0) / 2, np.interp(z, [zcr, zh, zw, zb], [0.80, 0.95, 0.92, 1.0]) * (yb1 - yb0) / 2
            ell = (np.hypot((X2 - cx) / ax, (Y2 - cyb) / ay) - 1) * min(ax, ay)
            F[i] = np.maximum((1 - w) * bot2 + w * ell, zcr - z)

    def capsule(a, b, ra, rb):
        a, b = np.asarray(a, float), np.asarray(b, float)
        ba = b - a
        px, py, pz = X - a[0], Y - a[1], Z - a[2]
        t = np.clip((px * ba[0] + py * ba[1] + pz * ba[2]) / (ba @ ba), 0, 1)
        d = np.sqrt((px - t * ba[0]) ** 2 + (py - t * ba[1]) ** 2 + (pz - t * ba[2]) ** 2)
        return d - (ra + t * (rb - ra))

    def ellipsoid(c, r):
        q = np.sqrt(((X - c[0]) / r[0]) ** 2 + ((Y - c[1]) / r[1]) ** 2 + ((Z - c[2]) / r[2]) ** 2)
        return (q - 1) * min(r)

    k = kf
    parts = [
        (capsule((cx, cyt + 10, zsh - 30), (cx, cyt + 15, zsh + 100 * k), 56 * k, 54 * k), 30 * k),  # neck
        (ellipsoid((cx, cyt + 8, zsh + 205 * k), (76 * k, 96 * k, 116 * k)), 30 * k),  # cranium
        (ellipsoid((cx, cyt - 40 * k, zsh + 130 * k), (50 * k, 42 * k, 40 * k)), 20 * k),  # jaw
        (ellipsoid((cx, cyt - 98 * k, zsh + 190 * k), (12 * k, 18 * k, 26 * k)), 10 * k),  # nose
    ]
    for s in (-1, 1):
        half = W / 2
        parts += [
            (ellipsoid((cx + s * (half - 30 * k), cyt + 5, zsh - 30 * k), (62 * k, 60 * k, 58 * k)), 35 * k),  # deltoid
            (capsule((cx + s * (half - 30 * k), cyt + 5, zsh - 35 * k), (cx + s * (half + 50 * k), cyt + 15, zsh - 320 * k), 50 * k, 40 * k), 25 * k),
            (capsule((cx + s * (half + 50 * k), cyt + 15, zsh - 320 * k), (cx + s * (half + 100 * k), cyt - 5, zsh - 570 * k), 40 * k, 29 * k), 15 * k),
            (ellipsoid((cx + s * (half + 112 * k), cyt - 10, zsh - 660 * k), (22 * k, 46 * k, 82 * k)), 15 * k),  # hand
            (capsule((cx + s * 92 * k, cyb + 10, zh - 30 * k), (cx + s * 96 * k, cyb, zsh - 960 * k), 86 * k, 56 * k), 45 * k),  # thigh
            (capsule((cx + s * 96 * k, cyb, zsh - 960 * k), (cx + s * 94 * k, cyb + 20, zf + 70 * k), 54 * k, 34 * k), 20 * k),  # shin
            (capsule((cx + s * 94 * k, cyb + 35, zf + 30 * k), (cx + s * 104 * k, cyb - 150 * k, zf + 22 * k), 36 * k, 26 * k), 25 * k),  # foot
        ]
    for d, ksm in parts:
        F = _smin(F, d.astype(np.float32), ksm)
    del X, Y, Z

    F = ndi.gaussian_filter(F, 1.6)  # porcelain-smooth surface: hides CT breathing/streak artefacts
    v, fc, _, _ = measure.marching_cubes(F, level=0.0, spacing=(G, G, G))
    v = v[:, ::-1] + np.array([xs[0], ys[0], zs[0]])
    shell = trimesh.Trimesh(v, fc[:, ::-1], process=True)
    trimesh.smoothing.filter_taubin(shell, iterations=30)
    if len(shell.faces) > 70000:
        shell = shell.simplify_quadric_decimation(face_count=70000)
    # "openness" per vertex: 1 where the shell lies on the real CT torso (fades out there, the X-ray torso shows),
    # 0 elsewhere (head, arms, legs). Soft at the scan's top/bottom cuts so the opening has no hard edge.
    v = shell.vertices
    kz = (v[:, 2] - origin[2]) / sp
    d = map_coordinates(S3, [kz, (v[:, 1] - origin[1]) / sp, (v[:, 0] - origin[0]) / sp], order=1, mode="nearest")
    ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
    zf_ = ss(zb, zb + 45, v[:, 2]) * (1 - ss(zt - 45, zt, v[:, 2]))
    open_ = zf_ * (1 - ss(6, 16, np.abs(d)))
    col = np.zeros((len(v), 4), np.uint8)
    col[:, 0] = np.round(open_ * 255)
    col[:, 3] = 255
    shell.visual.vertex_colors = col
    info = {"floorZ": round(float(zf), 1), "headTopZ": round(float(zsh + 321 * k), 1), "shoulderZ": round(float(zsh), 1),
            "torsoZ": [round(float(zb), 1), round(float(zt), 1)], "midlineX": round(mid_x, 1)}
    return shell, info


def largest_cc(mask: np.ndarray) -> np.ndarray:
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    return lab == sizes.argmax()


def vessel_fields(vessels: np.ndarray):
    """Clearance (mm) from any voxel to the nearest vessel wall, the calibre of that vessel,
    and clearance to the nearest large (>= 4 mm) vessel. Uses skeleton + inscribed radius."""
    shape = vessels.shape
    clear = np.full(shape, 255, np.uint8)
    cal = np.zeros(shape, np.uint8)
    clear_l = np.full(shape, 255, np.uint8)
    if not vessels.any():
        return clear, cal, clear_l
    radius = ndi.distance_transform_edt(vessels) * SP
    skel = morphology.skeletonize(vessels) > 0
    skel |= vessels & (radius >= 3.0) & (radius == ndi.maximum_filter(radius, 3))  # keep cores of big vessels
    r_sk = np.where(skel, radius, 0)

    def clearance(sk):
        d, ind = ndi.distance_transform_edt(~sk, sampling=SP, return_indices=True)
        rn = r_sk[ind[0], ind[1], ind[2]]
        del ind
        return np.maximum(d - rn, 0), rn

    c_all, r_all = clearance(skel)
    c_all[vessels] = 0
    clear[:] = np.clip(c_all * 4, 0, 255).astype(np.uint8)
    cal[:] = np.clip(r_all * 2 * 10, 0, 255).astype(np.uint8)
    big = skel & (r_sk >= 2.0)
    if big.any():
        c_big, _ = clearance(big)
        clear_l[:] = np.clip(c_big * 4, 0, 255).astype(np.uint8)
    return clear, cal, clear_l


if __name__ == "__main__":
    main()
