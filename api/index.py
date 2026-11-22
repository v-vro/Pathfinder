"""Vercel entry point. vercel.json rewrites every /api/* request here; the FastAPI app in
server/app.py keeps its own /api/... routes, so the same code serves local uvicorn and Vercel."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.app import app  # noqa: E402,F401  (Vercel serves the ASGI `app`)
