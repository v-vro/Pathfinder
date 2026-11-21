"""Run TotalSegmentator on a case (CPU-friendly defaults).

Produces data/<case>/seg/total.nii.gz (multilabel, ~117 structures incl. lung lobes, ribs, heart, great vessels)
and data/<case>/seg/lung_vessels.nii.gz (pulmonary vessels + airways).

Usage:
    python pipeline/segment.py --case-id lidc-0742            # fast (3 mm) total + lung vessels
    python pipeline/segment.py --case-id lidc-0742 --full     # full-res total (slow on CPU)
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def ts_exe() -> str:
    exe = Path(sys.executable).parent / ("TotalSegmentator.exe" if sys.platform == "win32" else "TotalSegmentator")
    return str(exe) if exe.exists() else (shutil.which("TotalSegmentator") or "TotalSegmentator")


def run(args: list[str]) -> None:
    print(">", " ".join(args), flush=True)
    t = time.time()
    subprocess.run(args, check=True)
    print(f"  done in {time.time() - t:.0f}s", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case-id", default="lidc-0742")
    ap.add_argument("--full", action="store_true", help="full-resolution total task (slow on CPU)")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--skip-vessels", action="store_true")
    args = ap.parse_args()

    case = DATA / args.case_id
    ct = case / "ct.nii.gz"
    seg = case / "seg"
    seg.mkdir(exist_ok=True)

    # fast (3 mm) -> total.nii.gz ; full (1.5 mm) -> total_full.nii.gz (build_case prefers the full one)
    total = seg / ("total_full.nii.gz" if args.full else "total.nii.gz")
    if not total.exists():
        cmd = [ts_exe(), "-i", str(ct), "-o", str(total), "--ml", "-d", args.device]
        if not args.full:
            cmd.append("--fast")
        run(cmd)

    vessels = seg / "lung_vessels.nii.gz"
    if not args.skip_vessels and not vessels.exists():
        try:
            run([ts_exe(), "-i", str(ct), "-o", str(vessels), "--ml", "-ta", "lung_vessels", "-d", args.device])
        except subprocess.CalledProcessError as e:
            print(f"lung_vessels failed ({e}); build_case.py will fall back to HU-threshold vessels")


if __name__ == "__main__":
    main()
