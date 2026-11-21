"""Download a public chest CT (LIDC-IDRI, CC BY 3.0) from The Cancer Imaging Archive and convert it to NIfTI.

The nodule location comes from the LUNA16 annotations (world/patient coordinates, mm), so the pipeline
knows where the suspicious spot is without manual clicking.

Usage:
    python pipeline/fetch_case.py                # default demo case
    python pipeline/fetch_case.py --series <SeriesInstanceUID> --case-id mycase
"""
from __future__ import annotations

import argparse
import io
import json
import zipfile
from pathlib import Path

import requests
import SimpleITK as sitk

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

TCIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1"

# Demo cases picked from LUNA16 annotations: thin-slice CT, one 15-25 mm nodule.
# (x, y, z) are DICOM patient coordinates (LPS, mm); d is nodule diameter in mm.
CASES = {
    "lidc-0742": {
        "series": "1.3.6.1.4.1.14519.5.2.1.6279.6001.286422846896797433168187085942",
        "nodules": [{"x": -91.0, "y": 9.0, "z": -73.0, "d": 22.2}],
    },
    "lidc-alt1": {
        "series": "1.3.6.1.4.1.14519.5.2.1.6279.6001.143622857676008763729469324839",
        "nodules": [{"x": -77.0, "y": -150.0, "z": -128.0, "d": 18.8}],
    },
    "lidc-alt2": {
        "series": "1.3.6.1.4.1.14519.5.2.1.6279.6001.206097113343059612247503064658",
        "nodules": [{"x": 67.0, "y": -123.0, "z": -156.0, "d": 20.4}],
    },
}


def fetch_annotations(series: str) -> list[dict]:
    """Look up LUNA16 nodule annotations for a series (exact coordinates)."""
    url = "https://zenodo.org/records/3723295/files/annotations.csv"
    text = requests.get(url, timeout=60).text
    out = []
    for line in text.splitlines()[1:]:
        uid, x, y, z, d = line.split(",")
        if uid == series:
            out.append({"x": float(x), "y": float(y), "z": float(z), "d": float(d)})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case-id", default="lidc-0742")
    ap.add_argument("--series", default=None, help="SeriesInstanceUID (overrides the preset)")
    args = ap.parse_args()

    preset = CASES.get(args.case_id, {})
    series = args.series or preset["series"]
    case_dir = DATA / args.case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    nii = case_dir / "ct.nii.gz"

    if not nii.exists():
        print(f"Downloading series {series} from TCIA ...")
        r = requests.get(f"{TCIA}/getImage", params={"SeriesInstanceUID": series}, timeout=600, stream=True)
        r.raise_for_status()
        buf = io.BytesIO()
        total = 0
        for chunk in r.iter_content(1 << 20):
            buf.write(chunk)
            total += len(chunk)
            print(f"\r  {total / 1e6:.0f} MB", end="", flush=True)
        print()
        dicom_dir = case_dir / "dicom"
        dicom_dir.mkdir(exist_ok=True)
        with zipfile.ZipFile(buf) as zf:
            for name in zf.namelist():
                # Flatten; refuse anything that tries to escape the folder.
                base = Path(name).name
                if base and not base.startswith("."):
                    (dicom_dir / base).write_bytes(zf.read(name))

        reader = sitk.ImageSeriesReader()
        files = reader.GetGDCMSeriesFileNames(str(dicom_dir))
        reader.SetFileNames(files)
        img = reader.Execute()
        sitk.WriteImage(img, str(nii), useCompression=True)
        print(f"Wrote {nii}  size={img.GetSize()} spacing={img.GetSpacing()}")
    else:
        print(f"{nii} already exists")

    nodules = preset.get("nodules") if not args.series else None
    try:
        exact = fetch_annotations(series)
        if exact:
            nodules = exact
    except Exception as e:  # network hiccup: fall back to preset coords
        print(f"(annotation lookup failed: {e})")

    meta = {"case_id": args.case_id, "series": series, "source": "LIDC-IDRI via TCIA (CC BY 3.0)",
            "nodules_lps": nodules or []}
    (case_dir / "case.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
