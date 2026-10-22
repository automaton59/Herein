from __future__ import annotations

import argparse
import io
import logging
import os
import time
from typing import Any

import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field


DEFAULT_CUSTOM_VOICE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
DEFAULT_VOICE_CLONE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
DEFAULT_EMOTION_INSTRUCTS = {
    "neutral": "用自然、平稳、像日常聊天一样的语气说",
    "happy": "用高兴、带一点笑意的语气说",
    "sad": "用低落、轻柔、克制的语气说",
    "angry": "用克制但明显不满的语气说",
    "shy": "用有些害羞、柔和的语气说",
    "excited": "用更高兴、更明亮、有活力的语气说",
    "worried": "用担心、放轻声音的语气说",
    "playful": "用轻快、俏皮、带笑意的语气说",
    "serious": "用认真、沉稳的语气说",
}


class TtsRequest(BaseModel):
    text: str = Field(min_length=1)
    mode: str | None = None
    emotion: str | None = None
    instruct: str | None = None
    language: str | None = None
    speaker: str | None = None
    ref_audio: str | None = None
    ref_text: str | None = None
    x_vector_only_mode: bool = False
    max_new_tokens: int | None = Field(default=None, ge=1)
    temperature: float | None = Field(default=None, gt=0)
    top_k: int | None = Field(default=None, ge=1)
    top_p: float | None = Field(default=None, gt=0, le=1)
    repetition_penalty: float | None = Field(default=None, gt=0)
    generation: dict[str, Any] | None = None


class ServiceState:
    model: Any | None = None
    loaded_at: float | None = None
    voice_clone_prompts: dict[str, Any] = {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local FastAPI wrapper for Qwen3-TTS CustomVoice.")
    parser.add_argument("--mode", default="custom_voice", choices=["custom_voice", "voice_clone"])
    parser.add_argument("--model", default="")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9881)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "bf16", "float16", "fp16", "float32", "fp32"])
    parser.add_argument("--flash-attn", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--language", default="Chinese")
    parser.add_argument("--speaker", default="Serena")
    parser.add_argument("--hf-endpoint", default=os.environ.get("HF_ENDPOINT", ""))
    parser.add_argument("--log-level", default="info")
    return parser.parse_args()


def default_model_for_mode(mode: str) -> str:
    return DEFAULT_VOICE_CLONE_MODEL if mode == "voice_clone" else DEFAULT_CUSTOM_VOICE_MODEL


def model_path(args: argparse.Namespace) -> str:
    return args.model or default_model_for_mode(args.mode)


def dtype_from_name(name: str) -> torch.dtype:
    normalized = name.strip().lower()
    if normalized in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if normalized in {"float16", "fp16"}:
        return torch.float16
    if normalized in {"float32", "fp32"}:
        return torch.float32
    raise ValueError(f"Unsupported dtype: {name}")


def clean(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def request_instruct(request: TtsRequest) -> str:
    explicit = clean(request.instruct)
    if explicit:
        return explicit

    emotion = clean(request.emotion).lower() or "neutral"
    return DEFAULT_EMOTION_INSTRUCTS.get(emotion, DEFAULT_EMOTION_INSTRUCTS["neutral"])


def request_mode(request: TtsRequest, fallback: str) -> str:
    mode = clean(request.mode).lower()
    if mode in {"custom_voice", "voice_clone"}:
        return mode
    return fallback


def voice_clone_prompt_key(ref_audio: str, ref_text: str, x_vector_only_mode: bool) -> str:
    return "\n".join([ref_audio, ref_text, "xvec" if x_vector_only_mode else "icl"])


def generation_kwargs(request: TtsRequest) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for key in ["max_new_tokens", "temperature", "top_k", "top_p", "repetition_penalty"]:
        value = getattr(request, key)
        if value is not None:
            values[key] = value

    if request.generation:
        values.update({key: value for key, value in request.generation.items() if value is not None})

    return values


def create_app(args: argparse.Namespace) -> FastAPI:
    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(message)s")
    if args.hf_endpoint:
        os.environ["HF_ENDPOINT"] = args.hf_endpoint
        logging.info("Using HuggingFace endpoint %s", args.hf_endpoint)

    app = FastAPI(title="Herein Qwen3-TTS Service")
    state = ServiceState()

    def load_model() -> Any:
        if state.model is not None:
            return state.model

        from qwen_tts import Qwen3TTSModel

        kwargs: dict[str, Any] = {
            "device_map": args.device,
            "dtype": dtype_from_name(args.dtype),
        }

        if args.flash_attn:
            kwargs["attn_implementation"] = "flash_attention_2"

        selected_model = model_path(args)
        logging.info("Loading Qwen3-TTS model %s on %s", selected_model, args.device)
        started = time.time()
        state.model = Qwen3TTSModel.from_pretrained(selected_model, **kwargs)
        state.loaded_at = time.time()
        logging.info("Qwen3-TTS loaded in %.2fs", state.loaded_at - started)
        return state.model

    @app.on_event("startup")
    def startup() -> None:
        load_model()

    @app.get("/health")
    def health() -> dict[str, Any]:
        model = state.model
        return {
            "ok": model is not None,
            "mode": args.mode,
            "model": model_path(args),
            "device": args.device,
            "dtype": args.dtype,
            "loadedAt": state.loaded_at,
            "supportedSpeakers": model.get_supported_speakers() if model else None,
            "supportedLanguages": model.get_supported_languages() if model else None,
        }

    @app.post("/tts")
    def synthesize(request: TtsRequest) -> Response:
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required")

        model = load_model()
        mode = request_mode(request, args.mode)
        language = clean(request.language) or args.language

        if mode == "custom_voice":
            speaker = clean(request.speaker) or args.speaker
            instruct = request_instruct(request)
            logging.info(
                "Synthesizing %.24r mode=custom_voice language=%s speaker=%s emotion=%s instruct=%.32r",
                text,
                language,
                speaker,
                request.emotion or "neutral",
                instruct,
            )
        else:
            ref_audio = clean(request.ref_audio)
            ref_text = clean(request.ref_text)
            if not ref_audio:
                raise HTTPException(status_code=400, detail="ref_audio is required for voice_clone mode")
            if not request.x_vector_only_mode and not ref_text:
                raise HTTPException(status_code=400, detail="ref_text is required for voice_clone ICL mode")
            logging.info(
                "Synthesizing %.24r mode=voice_clone language=%s emotion=%s ref_audio=%s",
                text,
                language,
                request.emotion or "neutral",
                ref_audio,
            )
        started = time.time()

        try:
            if mode == "voice_clone":
                ref_audio = clean(request.ref_audio)
                ref_text = clean(request.ref_text)
                cache_key = voice_clone_prompt_key(ref_audio, ref_text, request.x_vector_only_mode)
                prompt = state.voice_clone_prompts.get(cache_key)
                if prompt is None:
                    prompt = model.create_voice_clone_prompt(
                        ref_audio=ref_audio,
                        ref_text=ref_text or None,
                        x_vector_only_mode=request.x_vector_only_mode,
                    )
                    state.voice_clone_prompts[cache_key] = prompt
                wavs, sample_rate = model.generate_voice_clone(
                    text=text,
                    language=language,
                    voice_clone_prompt=prompt,
                    **generation_kwargs(request),
                )
            else:
                speaker = clean(request.speaker) or args.speaker
                instruct = request_instruct(request)
                wavs, sample_rate = model.generate_custom_voice(
                    text=text,
                    language=language,
                    speaker=speaker,
                    instruct=instruct or None,
                    **generation_kwargs(request),
                )
        except Exception as error:
            logging.exception("Qwen3-TTS synthesis failed")
            raise HTTPException(status_code=500, detail=f"{type(error).__name__}: {error}") from error

        if not wavs:
            raise HTTPException(status_code=500, detail="Qwen3-TTS returned no waveform")

        buffer = io.BytesIO()
        sf.write(buffer, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
        logging.info("Synthesis finished in %.2fs, sample_rate=%s", time.time() - started, sample_rate)

        return Response(
            content=buffer.getvalue(),
            media_type="audio/wav",
            headers={
                "X-Herein-TTS-Provider": "qwen3-tts",
                "X-Herein-TTS-Sample-Rate": str(sample_rate),
            },
        )

    return app


def main() -> int:
    args = parse_args()
    app = create_app(args)
    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
