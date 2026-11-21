"""Pathfinder API: Gemini-powered doctor plan narrative, patient explanation, patient Q&A, and TTS.

All numbers shown to people come from the deterministic planning engine (sent in `plan`);
Gemini only turns them into language. Without GEMINI_API_KEY the endpoints fall back to templates.

Run:  .venv/Scripts/python -m uvicorn server.app:app --reload --port 8000
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import wave
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import prompts

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
client = None
MODEL: str | None = None
TTS_MODEL: str | None = None

if API_KEY:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=API_KEY)


def _version_key(name: str) -> tuple:
    nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)", name.split("/")[-1])[:1]] or [0.0]
    return (nums[0], "preview" not in name, "exp" not in name)


def pick_models() -> None:
    """Use GEMINI_MODEL if set, otherwise the newest Flash text model this key can see."""
    global MODEL, TTS_MODEL
    MODEL = os.getenv("GEMINI_MODEL")
    TTS_MODEL = os.getenv("GEMINI_TTS_MODEL")
    if not client or (MODEL and TTS_MODEL):
        return
    try:
        names = []
        for m in client.models.list():
            actions = getattr(m, "supported_actions", None) or []
            if actions and "generateContent" not in actions:
                continue
            names.append(m.name)
        text = [n for n in names if "flash" in n and not any(k in n for k in ("lite", "tts", "image", "live", "audio", "embedding", "thinking"))]
        tts = [n for n in names if "tts" in n and "flash" in n]
        if not MODEL and text:
            MODEL = sorted(text, key=_version_key)[-1].split("/")[-1]
        if not TTS_MODEL and tts:
            TTS_MODEL = sorted(tts, key=_version_key)[-1].split("/")[-1]
    except Exception as e:  # offline / bad key: keep going with templates
        print(f"[pathfinder] could not list Gemini models: {e}")
    print(f"[pathfinder] Gemini text model: {MODEL}  TTS model: {TTS_MODEL}")


pick_models()

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
    return {"gemini": client is not None and MODEL is not None, "model": MODEL, "tts": TTS_MODEL}


async def generate(system: str, parts: list, temperature: float = 0.4) -> str:
    assert client is not None and MODEL
    resp = await client.aio.models.generate_content(
        model=MODEL,
        contents=parts,
        config=types.GenerateContentConfig(system_instruction=system, temperature=temperature),
    )
    return (resp.text or "").strip()


def image_part(data_url: str | None):
    if not data_url or not data_url.startswith("data:image"):
        return None
    header, b64 = data_url.split(",", 1)
    mime = header.split(";")[0][5:]
    return types.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime)


@app.post("/api/doctor-plan")
async def doctor_plan(req: PlanReq):
    if not (client and MODEL):
        return {"markdown": prompts.doctor_template(req.plan), "source": "template"}
    try:
        text = await generate(prompts.DOCTOR_SYSTEM, [prompts.doctor_user(req.plan)], 0.3)
        return {"markdown": text, "source": MODEL}
    except Exception as e:
        return {"markdown": prompts.doctor_template(req.plan), "source": "template", "error": str(e)}


@app.post("/api/patient-explain")
async def patient_explain(req: ExplainReq):
    if not (client and MODEL):
        return {"text": prompts.patient_template(req.plan), "source": "template"}
    parts: list = [prompts.patient_user(req.plan, req.language)]
    img = image_part(req.image)
    if img is not None:
        parts.insert(0, img)
    try:
        text = await generate(prompts.PATIENT_SYSTEM, parts, 0.5)
        return {"text": text, "source": MODEL}
    except Exception as e:
        return {"text": prompts.patient_template(req.plan), "source": "template", "error": str(e)}


@app.post("/api/patient-chat")
async def patient_chat(req: ChatReq):
    if not (client and MODEL):
        return {"text": "The AI assistant isn't configured on this machine (no GEMINI_API_KEY). Please ask your care team.", "source": "template"}
    history = "\n".join(f"{h.get('role', 'user').upper()}: {h.get('text', '')}" for h in req.history[-12:])
    user = prompts.chat_user(req.plan, req.language, history, req.question)
    try:
        return {"text": await generate(prompts.CHAT_SYSTEM, [user], 0.4), "source": MODEL}
    except Exception as e:
        raise HTTPException(502, f"Gemini error: {e}")


@app.post("/api/tts")
async def tts(req: TtsReq):
    if not (client and TTS_MODEL):
        raise HTTPException(503, "TTS not configured")
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
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return Response(buf.getvalue(), media_type="audio/wav")


# ---- serve the built web app (npm run build) in production
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
