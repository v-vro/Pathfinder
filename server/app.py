"""Pathfinder API: Gemini-powered doctor plan narrative, patient explanation, patient Q&A, and optional TTS.

All numbers shown to people come from the deterministic planning engine (sent in `plan`);
Gemini only turns them into language. Without GEMINI_API_KEY, or when Gemini is down, the
plan/explain endpoints fall back to offline templates (source = "template").

Config (environment variables; locally also read from .env):
  GEMINI_API_KEY         required for Gemini (GOOGLE_API_KEY also accepted)
  GEMINI_MODEL           main text model           (default gemini-3.5-flash)
  GEMINI_FALLBACK_MODEL  used after the main model fails twice (default gemini-3.1-flash-lite)
  GEMINI_TTS_MODEL       optional; read-aloud is off unless this is set

Runs two ways:
  local   .venv/Scripts/python -m uvicorn server.app:app --reload --port 8000
  Vercel  api/index.py imports `app` as a Python serverless function (see vercel.json)
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import time
import wave
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import prompts

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")  # no-op on Vercel, where env vars come from the project settings

log = logging.getLogger("pathfinder")


def _env(name: str, default: str | None = None) -> str | None:
    return (os.getenv(name) or "").strip() or default


API_KEY = _env("GEMINI_API_KEY") or _env("GOOGLE_API_KEY")
MODEL = _env("GEMINI_MODEL", "gemini-3.5-flash")
FALLBACK_MODEL = _env("GEMINI_FALLBACK_MODEL", "gemini-3.1-flash-lite")
TTS_MODEL = _env("GEMINI_TTS_MODEL")
# Total time we give Gemini per request, retries and fallback included. Must stay under the
# function's maxDuration in vercel.json (30 s) so we can still answer with the template.
BUDGET_S = float(_env("GEMINI_BUDGET_S", "26") or 26)
FALLBACK_RESERVE_S = 8.0  # time held back so the (fast) fallback model still gets a try

client = None
if API_KEY:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=API_KEY)

app = FastAPI(title="Pathfinder API")


class PlanReq(BaseModel):
    plan: dict[str, Any]


class ExplainReq(BaseModel):
    plan: dict[str, Any]
    language: str = "English"
    image: str | None = None  # data URL of the 3D view (optional, multimodal)


class ChatReq(BaseModel):
    plan: dict[str, Any]
    language: str = "English"
    history: list[dict[str, str]] = []
    question: str


class TtsReq(BaseModel):
    text: str
    language: str = "English"
    voice: str = "Kore"


@app.get("/api/health")
def health():
    return {
        "gemini": client is not None,
        "model": MODEL,
        "fallback": FALLBACK_MODEL,
        "tts": client is not None and TTS_MODEL is not None,
    }


class GeminiUnavailable(Exception):
    """Every attempt failed (or there is no key). Callers answer with a template instead."""


async def _call(model: str, system: str, parts: list, temperature: float, timeout: float) -> str:
    resp = await asyncio.wait_for(
        client.aio.models.generate_content(
            model=model,
            contents=parts,
            config=types.GenerateContentConfig(system_instruction=system, temperature=temperature),
        ),
        timeout,
    )
    text = (resp.text or "").strip()
    if not text:
        raise ValueError("empty response")
    return text


async def generate(system: str, parts: list, temperature: float = 0.4) -> tuple[str, str]:
    """Main model, one retry, then the fallback model, all inside BUDGET_S. Returns (text, model used)."""
    if client is None:
        raise GeminiUnavailable("no API key")
    deadline = time.monotonic() + BUDGET_S
    fallback = FALLBACK_MODEL if FALLBACK_MODEL and FALLBACK_MODEL != MODEL else None
    attempts = [MODEL, MODEL] + ([fallback] if fallback else [])
    timed_out: set[str] = set()
    for i, model in enumerate(attempts):
        if model in timed_out:  # a model that just used its whole slot won't do better on a retry
            continue
        if i == 1:
            await asyncio.sleep(0.6)  # brief pause before the retry (typical failure is a transient 503)
        left = deadline - time.monotonic()
        later_fallback = fallback is not None and model != fallback
        timeout = left - FALLBACK_RESERVE_S if later_fallback else left
        if timeout < 2:
            continue
        try:
            return await _call(model, system, parts, temperature, timeout), model
        except asyncio.TimeoutError:
            timed_out.add(model)
            log.warning("gemini %s attempt %d timed out after %.0fs", model, i + 1, timeout)
        except Exception as e:  # never forwarded to the client
            log.warning("gemini %s attempt %d failed: %s: %s", model, i + 1, type(e).__name__, str(e)[:300])
    raise GeminiUnavailable("all attempts failed")


def image_part(data_url: str | None):
    if not data_url or not data_url.startswith("data:image"):
        return None
    try:
        header, b64 = data_url.split(",", 1)
        mime = header.split(";")[0][5:]
        return types.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime)
    except Exception:
        return None  # a bad snapshot shouldn't cost the patient their explanation


@app.post("/api/doctor-plan")
async def doctor_plan(req: PlanReq):
    try:
        text, model = await generate(prompts.DOCTOR_SYSTEM, [prompts.doctor_user(req.plan)], 0.3)
        return {"markdown": text, "source": model}
    except GeminiUnavailable:
        return {"markdown": prompts.doctor_template(req.plan), "source": "template"}


@app.post("/api/patient-explain")
async def patient_explain(req: ExplainReq):
    parts: list = [prompts.patient_user(req.plan, req.language)]
    if client is not None:
        img = image_part(req.image)
        if img is not None:
            parts.insert(0, img)
    try:
        text, model = await generate(prompts.PATIENT_SYSTEM, parts, 0.5)
        return {"text": text, "source": model}
    except GeminiUnavailable:
        return {"text": prompts.patient_template(req.plan), "source": "template"}


@app.post("/api/patient-chat")
async def patient_chat(req: ChatReq):
    history = "\n".join(f"{h.get('role', 'user').upper()}: {h.get('text', '')}" for h in req.history[-12:])
    user = prompts.chat_user(req.plan, req.language, history, req.question)
    try:
        text, model = await generate(prompts.CHAT_SYSTEM, [user], 0.4)
        return {"text": text, "source": model}
    except GeminiUnavailable:
        # The client shows its own friendly "busy" message; no error details leave the server.
        return JSONResponse({"busy": True}, status_code=503)


@app.post("/api/tts")
async def tts(req: TtsReq):
    if not (client and TTS_MODEL):
        return JSONResponse({"tts": False}, status_code=404)
    try:
        resp = await client.aio.models.generate_content(
            model=TTS_MODEL,
            contents=f"Say warmly and calmly, in {req.language}: {req.text}",
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=req.voice))
                ),
            ),
        )
        pcm = resp.candidates[0].content.parts[0].inline_data.data
    except Exception as e:
        log.warning("tts %s failed: %s: %s", TTS_MODEL, type(e).__name__, str(e)[:300])
        return JSONResponse({"tts": False}, status_code=503)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return Response(buf.getvalue(), media_type="audio/wav")


# ---- serve the built web app (npm run build) when running locally with uvicorn.
# On Vercel the site is static and web/ is excluded from the function bundle, so this is skipped.
DIST = ROOT / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    for sub in ("cases", "models", "mediapipe"):
        if (DIST / sub).exists():
            app.mount(f"/{sub}", StaticFiles(directory=DIST / sub), name=sub)

    @app.get("/")
    def index():
        return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    print(json.dumps(health()))
