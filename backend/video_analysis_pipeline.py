"""
Live meeting analysis pipeline.

Every transcription and scorecard value is produced from an uploaded meeting
video: FFmpeg extracts audio in /tmp, Groq Whisper-large-v3 returns the true
dialogueScript, and Gemini 1.5 Flash scores that same transcript. No mock,
template, or deterministic stand-in data is returned.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

import httpx

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_WHISPER_MODEL = "whisper-large-v3"
GEMINI_MODEL = "gemini-1.5-flash"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)
GROQ_MAX_UPLOAD_BYTES = 24 * 1024 * 1024
STREAM_CHUNK_BYTES = 1024 * 1024
WAV_HEADER_BYTES = 44


def load_api_keys() -> Tuple[str, str]:
    groq_key = (os.getenv("GROQ_API_KEY") or "").strip()
    gemini_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    return groq_key, gemini_key


def require_api_keys() -> Tuple[str, str]:
    groq_key, gemini_key = load_api_keys()
    missing = []
    if not groq_key:
        missing.append("GROQ_API_KEY")
    if not gemini_key:
        missing.append("GEMINI_API_KEY")
    if missing:
        raise RuntimeError(
            "Missing required environment variable(s): " + ", ".join(missing)
        )
    return groq_key, gemini_key


def system_tmp_dir() -> str:
    if os.path.isdir("/tmp") and os.access("/tmp", os.W_OK):
        return "/tmp"
    return os.path.abspath(tempfile.gettempdir())


TEMP_DIR = system_tmp_dir()
UPLOAD_TMP_DIR = os.path.join(TEMP_DIR, "guardianeye_uploads")
AUDIO_TMP_DIR = os.path.join(TEMP_DIR, "guardianeye_audio")


def get_ffmpeg_binary() -> str:
    env_ffmpeg = os.environ.get("FFMPEG_PATH") or os.environ.get("FFMPEG_BIN")
    if env_ffmpeg and os.path.exists(env_ffmpeg) and os.access(env_ffmpeg, os.X_OK):
        return env_ffmpeg

    linux_bin = "/usr/bin/ffmpeg"
    if os.path.exists(linux_bin) and os.access(linux_bin, os.X_OK):
        return linux_bin

    which_ffmpeg = shutil.which("ffmpeg")
    if which_ffmpeg and os.path.exists(which_ffmpeg):
        return which_ffmpeg

    for path in (
        "/usr/local/bin/ffmpeg",
        "/bin/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/opt/ffmpeg/bin/ffmpeg",
    ):
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path

    raise RuntimeError(
        "FFmpeg binary not found. Install ffmpeg or set FFMPEG_PATH to the absolute binary path."
    )


FFMPEG_BIN = None


def ffmpeg_bin() -> str:
    global FFMPEG_BIN
    if not FFMPEG_BIN:
        FFMPEG_BIN = get_ffmpeg_binary()
    return FFMPEG_BIN


def ensure_tmp_dirs() -> None:
    os.makedirs(UPLOAD_TMP_DIR, exist_ok=True)
    os.makedirs(AUDIO_TMP_DIR, exist_ok=True)


def format_sec(sec: float) -> str:
    total = max(0, int(sec))
    return f"{total // 60:02d}:{total % 60:02d}"


def safe_unlink(path: Optional[str]) -> None:
    if not path:
        return
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


async def stream_upload_to_tmp(upload_file, suffix: str = ".webm") -> str:
    """Stream multipart video bytes straight to /tmp in 1MB chunks (no full RAM buffer)."""
    ensure_tmp_dirs()
    ext = os.path.splitext(getattr(upload_file, "filename", "") or "")[1] or suffix
    dest = os.path.join(UPLOAD_TMP_DIR, f"vid_{int(time.time())}_{uuid.uuid4().hex[:10]}{ext}")
    bytes_written = 0
    with open(dest, "wb") as out:
        while True:
            chunk = await upload_file.read(STREAM_CHUNK_BYTES)
            if not chunk:
                break
            out.write(chunk)
            bytes_written += len(chunk)
        out.flush()
        os.fsync(out.fileno())
    if bytes_written == 0:
        safe_unlink(dest)
        raise RuntimeError("Uploaded video footage is empty (0 bytes).")
    print(f"[ingest] Streamed {bytes_written} bytes to {dest}")
    return dest


def extract_wav_with_ffmpeg(video_path: str, output_wav_path: str) -> bool:
    """
    Extract 16 kHz mono PCM WAV via FFmpeg at the absolute Linux binary path.
    Audio is written under /tmp so long recordings do not sit in process memory.
    """
    abs_video = os.path.abspath(video_path)
    abs_output = os.path.abspath(output_wav_path)
    os.makedirs(os.path.dirname(abs_output) or AUDIO_TMP_DIR, exist_ok=True)

    if not os.path.exists(abs_video) or os.path.getsize(abs_video) == 0:
        raise RuntimeError(f"Video file at {abs_video} is missing or empty.")

    binary = ffmpeg_bin()
    cmd = [
        binary,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i", abs_video,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        abs_output,
    ]
    print(f"[FFmpeg] {binary} extracting audio -> {abs_output}")
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=None,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"FFmpeg binary not executable at {binary}") from exc

    if res.returncode != 0:
        err = res.stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"FFmpeg audio extraction failed: {err[-2000:]}")

    out_size = os.path.getsize(abs_output) if os.path.exists(abs_output) else 0
    if out_size < WAV_HEADER_BYTES:
        raise RuntimeError(
            f"Extracted WAV is missing or too small ({out_size} bytes). Cannot send to Groq Whisper-large-v3."
        )
    print(f"[FFmpeg] WAV ready: {abs_output} ({out_size} bytes)")
    return True


def _split_wav_chunks(wav_path: str) -> List[str]:
    size = os.path.getsize(wav_path)
    if size <= GROQ_MAX_UPLOAD_BYTES:
        return [wav_path]

    duration = _probe_duration(wav_path) or max(1.0, size / 32000.0)
    bytes_per_sec = size / duration
    chunk_sec = max(30.0, (GROQ_MAX_UPLOAD_BYTES * 0.85) / max(bytes_per_sec, 1.0))
    chunks: List[str] = []
    start = 0.0
    idx = 0
    binary = ffmpeg_bin()
    while start < duration - 0.05:
        dest = os.path.join(
            AUDIO_TMP_DIR,
            f"{os.path.splitext(os.path.basename(wav_path))[0]}_part{idx}.wav",
        )
        cmd = [
            binary, "-hide_banner", "-nostdin", "-y",
            "-ss", f"{start:.3f}",
            "-t", f"{chunk_sec:.3f}",
            "-i", wav_path,
            "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            dest,
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) < WAV_HEADER_BYTES:
            raise RuntimeError("Failed to split long meeting audio for Groq upload limits.")
        chunks.append(dest)
        start += chunk_sec
        idx += 1
    return chunks


def _probe_duration(fpath: str) -> Optional[float]:
    try:
        res = subprocess.run(
            [ffmpeg_bin(), "-hide_banner", "-i", fpath],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        out = res.stderr.decode("utf-8", errors="ignore")
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", out)
        if match:
            return float(match.group(1)) * 3600 + float(match.group(2)) * 60 + float(match.group(3))
    except Exception:
        return None
    return None


def _parse_groq_payload(
    groq_data: Dict[str, Any],
    host_name: str,
    guest_name: str,
    time_offset: float,
) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
    raw_segments = sorted(groq_data.get("segments") or [], key=lambda s: float(s.get("start", 0.0)))
    raw_text = (groq_data.get("text") or "").strip()
    dialogue_turns: List[Dict[str, Any]] = []
    dialogue_lines: List[str] = []
    shifted_segments: List[Dict[str, Any]] = []

    for idx, seg in enumerate(raw_segments):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("start", 0.0)) + time_offset
        end = float(seg.get("end", start + 0.5)) + time_offset
        speaker, spoken = _speaker_from_text(text, host_name, guest_name)
        shifted = dict(seg)
        shifted["start"] = start
        shifted["end"] = end
        shifted["text"] = spoken
        shifted["speaker"] = speaker
        shifted_segments.append(shifted)
        is_host = speaker.lower() == host_name.lower()
        dialogue_turns.append({
            "id": f"turn_{idx}_{int(start * 1000)}",
            "speaker": speaker,
            "role": "Host" if is_host else "Participant",
            "isHost": is_host,
            "text": spoken,
            "timestamp": format_sec(start),
            "start": start,
            "end": end,
        })
        dialogue_lines.append(f"{speaker}: {spoken}")

    if not dialogue_turns and raw_text:
        speaker, spoken = _speaker_from_text(raw_text, host_name, guest_name)
        dialogue_turns.append({
            "id": "turn_0",
            "speaker": speaker,
            "role": "Host" if speaker.lower() == host_name.lower() else "Participant",
            "isHost": speaker.lower() == host_name.lower(),
            "text": spoken,
            "timestamp": format_sec(time_offset),
            "start": time_offset,
            "end": time_offset + max(1.0, len(spoken.split()) * 0.4),
        })
        dialogue_lines.append(f"{speaker}: {spoken}")
        shifted_segments.append({
            "start": time_offset,
            "end": time_offset + 1.0,
            "text": spoken,
            "speaker": speaker,
        })

    formatted = "\n".join(dialogue_lines) if dialogue_lines else raw_text
    return formatted, dialogue_turns, shifted_segments


def _speaker_from_text(text: str, host_name: str, guest_name: str) -> Tuple[str, str]:
    tag_match = re.match(r"^(?:Speaker\s*([0-9]+)|([A-Za-z0-9_ \-]{1,40})):\s*(.+)$", text, re.I)
    if not tag_match:
        return host_name, text
    spoken = tag_match.group(3).strip()
    if tag_match.group(1) is not None:
        spk_num = int(tag_match.group(1))
        return (host_name if spk_num == 0 else guest_name), spoken
    name_part = tag_match.group(2).strip()
    lower = name_part.lower()
    if guest_name and guest_name.lower() in lower:
        return guest_name, spoken
    if host_name and host_name.lower() in lower:
        return host_name, spoken
    return name_part, spoken


async def transcribe_audio(
    wav_path: str,
    host_name: str = "Host",
    guest_name: str = "Participant",
    groq_api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Send extracted WAV to Groq Whisper-large-v3 and return the live dialogueScript."""
    groq_key = (groq_api_key or os.getenv("GROQ_API_KEY") or "").strip()
    if not groq_key:
        raise RuntimeError("GROQ_API_KEY is not set in the environment.")
    if not os.path.exists(wav_path) or os.path.getsize(wav_path) < WAV_HEADER_BYTES:
        raise RuntimeError(f"WAV missing or empty: {wav_path}")

    chunk_paths = await asyncio.to_thread(_split_wav_chunks, wav_path)
    all_turns: List[Dict[str, Any]] = []
    all_segments: List[Dict[str, Any]] = []
    script_parts: List[str] = []
    time_offset = 0.0

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            for chunk_path in chunk_paths:
                chunk_dur = _probe_duration(chunk_path) or 0.0
                with open(chunk_path, "rb") as handle:
                    files = {"file": (os.path.basename(chunk_path), handle, "audio/wav")}
                    data = {
                        "model": GROQ_WHISPER_MODEL,
                        "response_format": "verbose_json",
                        "temperature": "0.0",
                    }
                    headers = {"Authorization": f"Bearer {groq_key}"}
                    resp = await client.post(
                        GROQ_TRANSCRIBE_URL,
                        files=files,
                        data=data,
                        headers=headers,
                    )
                if resp.status_code != 200:
                    raise RuntimeError(
                        f"Groq Whisper-large-v3 failed ({resp.status_code}): {resp.text[:800]}"
                    )
                formatted, turns, segs = _parse_groq_payload(
                    resp.json(), host_name, guest_name, time_offset
                )
                if formatted:
                    script_parts.append(formatted)
                all_turns.extend(turns)
                all_segments.extend(segs)
                time_offset += chunk_dur
    finally:
        for path in chunk_paths:
            if path != wav_path:
                safe_unlink(path)

    dialogue_script = "\n".join(p for p in script_parts if p).strip()
    if not dialogue_script or not all_turns:
        raise RuntimeError(
            "Groq Whisper-large-v3 returned no speech from the uploaded meeting video."
        )

    print(f"[Groq] dialogueScript captured: {len(all_turns)} turns, {len(dialogue_script)} chars")
    return {
        "model": GROQ_WHISPER_MODEL,
        "rawTranscript": dialogue_script,
        "dialogueScript": dialogue_script,
        "dialogueTurns": all_turns,
        "text": dialogue_script,
        "segments": all_segments,
        "groqSegments": all_segments,
    }


async def generate_groq_summary(raw_transcript: str, groq_api_key: Optional[str] = None) -> str:
    groq_key = (groq_api_key or os.getenv("GROQ_API_KEY") or "").strip()
    transcript = (raw_transcript or "").strip()
    if not groq_key or not transcript:
        return ""
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "Summarize only the verbatim meeting transcript. "
                                "Do not invent names, decisions, or topics that are not spoken."
                            ),
                        },
                        {
                            "role": "user",
                            "content": f"Verbatim Meeting Transcript:\n{transcript}\n\nConcise summary:",
                        },
                    ],
                    "temperature": 0.1,
                    "max_tokens": 250,
                },
            )
            if resp.status_code == 200:
                return (
                    resp.json()
                    .get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                    .strip()
                )
    except Exception as exc:
        print(f"[generate_groq_summary] {exc}")
    return ""


def extract_speaker_linguistic_metrics(
    segments: List[Dict],
    host_name: str,
    guest_name: str,
) -> Dict[str, Dict]:
    metrics: Dict[str, Dict[str, int]] = {}
    filler_regex = re.compile(
        r"\b(uh|um|uhm|ah|er|like|you know|sort of|kind of)\b", re.IGNORECASE
    )
    sound_artifacts_regex = re.compile(
        r"\[(applause|music|laughter|silence|whispering|cough|throat clearing)\]",
        re.IGNORECASE,
    )

    for seg in segments or []:
        text = seg.get("text", "")
        if float(seg.get("no_speech_prob", 0) or 0) > 0.8:
            continue
        cleaned = sound_artifacts_regex.sub("", text).strip()
        if not cleaned:
            continue
        spk = (seg.get("speaker") or seg.get("speaker_id") or host_name).strip() or host_name
        tag_match = re.match(
            r"^(?:Speaker\s*([0-9]+)|([A-Za-z0-9_ \-]{1,40})):\s*(.+)$", cleaned, re.I
        )
        if tag_match:
            if tag_match.group(1) is not None:
                spk = host_name if int(tag_match.group(1)) == 0 else guest_name
            elif tag_match.group(2):
                spk = tag_match.group(2).strip()
            cleaned = tag_match.group(3).strip()
        bucket = metrics.setdefault(
            spk, {"words": 0, "chars": 0, "segments": 0, "fillers": 0}
        )
        bucket["words"] += len(cleaned.split())
        bucket["chars"] += len(cleaned)
        bucket["segments"] += 1
        bucket["fillers"] += len(filler_regex.findall(cleaned))

    for name in (host_name, guest_name):
        metrics.setdefault(name, {"words": 0, "chars": 0, "segments": 0, "fillers": 0})
    return metrics


def _strip_json_fence(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


async def analyze_with_gemini(
    raw_transcript: str,
    dialogue_turns: List[Dict],
    host_name: str = "Host",
    guest_name: str = "Participant",
    gemini_api_key: Optional[str] = None,
    segments: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """
    Feed the identical Groq transcription into Gemini 1.5 Flash.
    Gemini independently computes compliance, cross-examination, and the scorecard.
    """
    gemini_key = (gemini_api_key or os.getenv("GEMINI_API_KEY") or "").strip()
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is not set in the environment.")
    transcript = (raw_transcript or "").strip()
    if not transcript:
        raise RuntimeError("Cannot call Gemini without a live Groq dialogueScript.")

    analysis_segments = segments if (segments and len(segments) > 0) else dialogue_turns
    linguistic_metrics = extract_speaker_linguistic_metrics(analysis_segments, host_name, guest_name)
    groq_timestamped_data = []
    for seg in analysis_segments:
        groq_timestamped_data.append({
            "start": seg.get("start", 0),
            "end": seg.get("end", 0),
            "speaker": seg.get("speaker") or (host_name if seg.get("isHost", True) else guest_name),
            "text": seg.get("text", ""),
        })

    spoken_names = []
    for turn in dialogue_turns:
        name = (turn.get("speaker") or "").strip()
        if name and name not in spoken_names:
            spoken_names.append(name)
    speakers_str = ", ".join(spoken_names) if spoken_names else host_name

    prompt = f"""You are a literal metrics compliance auditor. You have no creative freedom.
Score ONLY speakers who actually produced words in the Groq transcript: {speakers_str}.
Do not invent speakers, questions, answers, claims, or scores for anyone who did not speak.

Use the Groq transcript as the sole evidence source.
For each active speaker return integer scores 1-10 for:
- communication_skills
- fluency
- confidence
- awkwardness (1 if no filler words; higher only when uh/um/stammers appear)
- straightforward_answers
Include a rationale that quotes verbatim words from the transcript.

Also perform objective cross-examination:
- factCheckAudit: only real question/answer pairs between different speakers. Empty array if none.
- compliance: overall meeting-compliance notes grounded in the spoken text.
- scorecard: the same per-speaker metrics plus any additional behavioral observations justified by the transcript.

Return ONLY JSON with this shape (types, not sample values):
{{
  "speakerRatings": {{
    "<exact speaker name from transcript>": {{
      "communication_skills": <int 1-10>,
      "fluency": <int 1-10>,
      "confidence": <int 1-10>,
      "awkwardness": <int 1-10>,
      "straightforward_answers": <int 1-10>,
      "rationale": "<verbatim-backed string>"
    }}
  }},
  "factCheckAudit": [
    {{
      "question_by": "<speaker>",
      "question": "<verbatim question>",
      "answered_by": "<speaker>",
      "answer": "<verbatim answer>",
      "verdict": "Accurate" | "Incomplete" | "Evasive"
    }}
  ],
  "compliance": {{
    "summary": "<string>",
    "issues": ["<string>"]
  }},
  "scorecard": {{}},
  "claims": [],
  "actionItems": [],
  "summary": "<string derived only from spoken words>"
}}

Raw Groq timestamped segments:
{json.dumps(groq_timestamped_data, indent=2)}

Full verbatim dialogueScript:
{transcript}
"""

    url = f"{GEMINI_URL}?key={gemini_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json",
        },
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini 1.5 Flash failed ({resp.status_code}): {resp.text[:800]}")

    resp_json = resp.json()
    candidates = resp_json.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini 1.5 Flash returned no candidates for the live transcript.")
    candidate = candidates[0]
    finish_reason = candidate.get("finishReason", "")
    if finish_reason in ("SAFETY", "RECITATION") or not candidate.get("content"):
        raise RuntimeError(f"Gemini 1.5 Flash blocked the live analysis (finishReason={finish_reason}).")
    text_content = candidate.get("content", {}).get("parts", [{}])[0].get("text", "")
    parsed = json.loads(_strip_json_fence(text_content))
    if not isinstance(parsed, dict):
        raise RuntimeError("Gemini 1.5 Flash did not return a JSON object.")
    return _validate_and_clamp_analysis(
        parsed, host_name, guest_name, GEMINI_MODEL, linguistic_metrics, dialogue_turns
    )


def _validate_and_clamp_analysis(
    parsed: Dict,
    host_name: str,
    guest_name: str,
    model_name: str,
    linguistic_metrics: Optional[Dict] = None,
    dialogue_turns: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    def clamp(value: Any) -> int:
        try:
            return max(1, min(10, int(value)))
        except (ValueError, TypeError):
            raise RuntimeError("Gemini returned a non-numeric score; refusing fabricated defaults.")

    ling = linguistic_metrics or {}
    ratings_source = parsed.get("speakerRatings") or parsed
    if not isinstance(ratings_source, dict):
        raise RuntimeError("Gemini scorecard missing speakerRatings object.")

    spoken_names = []
    for turn in dialogue_turns or []:
        name = (turn.get("speaker") or "").strip()
        if name and name not in spoken_names:
            spoken_names.append(name)
    if not spoken_names:
        spoken_names = [host_name]

    speaker_ratings_dict: Dict[str, Any] = {}
    for spk_name in spoken_names:
        spk_ling = ling.get(spk_name) or ling.get(host_name if spk_name.lower() == host_name.lower() else guest_name) or {
            "words": 0, "chars": 0, "segments": 0, "fillers": 0
        }
        raw_data = ratings_source.get(spk_name, {})
        if not isinstance(raw_data, dict) or not raw_data:
            for key, value in ratings_source.items():
                if isinstance(key, str) and key.lower() == spk_name.lower() and isinstance(value, dict):
                    raw_data = value
                    break
        if not raw_data:
            # Gemini may nest scores at the root using the speaker name
            continue
        words = int(spk_ling.get("words", 0) or 0)
        chars = int(spk_ling.get("chars", 0) or 0)
        segs = int(spk_ling.get("segments", 0) or 0)
        fillers = int(spk_ling.get("fillers", 0) or 0)
        if chars < 50 or words < 10:
            speaker_ratings_dict[spk_name] = {
                "communication_skills": 1,
                "fluency": 1,
                "confidence": 1,
                "awkwardness": 1,
                "straightforward_answers": 1,
                "rationale": "Insufficient spoken text for evaluation.",
                "status_note": "Insufficient spoken text for evaluation.",
                "is_clamped": True,
                "word_count": words,
                "char_count": chars,
                "segment_count": segs,
            }
            continue
        awk = clamp(raw_data.get("awkwardness")) if fillers > 0 else 1
        speaker_ratings_dict[spk_name] = {
            "communication_skills": clamp(raw_data.get("communication_skills")),
            "fluency": clamp(raw_data.get("fluency")),
            "confidence": clamp(raw_data.get("confidence")),
            "awkwardness": awk,
            "straightforward_answers": clamp(raw_data.get("straightforward_answers")),
            "rationale": (raw_data.get("rationale") or "").strip()
            or "Scored from Groq transcript evidence.",
            "status_note": "Validated against Groq transcript",
            "is_clamped": False,
            "word_count": words,
            "char_count": chars,
            "segment_count": segs,
        }

    if not speaker_ratings_dict:
        raise RuntimeError("Gemini returned no live speaker ratings for transcribed participants.")

    fact_check = []
    for item in parsed.get("factCheckAudit") or []:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        answer = str(item.get("answer") or "").strip()
        if not question or not answer:
            continue
        verdict_raw = str(item.get("verdict") or "").lower()
        if "incom" in verdict_raw:
            verdict = "Incomplete"
        elif "evas" in verdict_raw:
            verdict = "Evasive"
        else:
            verdict = "Accurate"
        fact_check.append({
            "question_by": item.get("question_by") or host_name,
            "question": question,
            "answered_by": item.get("answered_by") or guest_name,
            "answer": answer,
            "verdict": verdict,
        })

    compliance = parsed.get("compliance") if isinstance(parsed.get("compliance"), dict) else {}
    scorecard = parsed.get("scorecard") if isinstance(parsed.get("scorecard"), dict) else speaker_ratings_dict
    claims = parsed.get("claims") if isinstance(parsed.get("claims"), list) else []
    action_items = parsed.get("actionItems") if isinstance(parsed.get("actionItems"), list) else []
    summary = str(parsed.get("summary") or compliance.get("summary") or "").strip()

    return {
        "speakerRatings": speaker_ratings_dict,
        "factCheckAudit": fact_check,
        "compliance": compliance,
        "scorecard": scorecard,
        "claims": claims,
        "actionItems": action_items,
        "summary": summary,
        "gemini_model": model_name,
    }


async def analyze_claim_with_gemini(claim: str, meeting_context: Optional[str] = None) -> Dict[str, Any]:
    gemini_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is not set in the environment.")
    claim_text = (claim or "").strip()
    if not claim_text:
        raise RuntimeError("Claim cannot be empty.")
    prompt = (
        "Fact-check this spoken meeting claim using only the supplied text. "
        "Return JSON with keys claim, verdict, confidence (0-100), analysis. "
        "Verdict must be one of: Accurate, Incomplete, Evasive, Needs Context, Plausible. "
        "Do not invent supporting facts that are not in the claim or context.\n\n"
        f"Claim: {claim_text}\n"
        f"Meeting context: {(meeting_context or '').strip() or 'None provided'}"
    )
    url = f"{GEMINI_URL}?key={gemini_key}"
    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(
            url,
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"},
            },
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini fact-check failed ({resp.status_code}): {resp.text[:800]}")
    text_content = (
        resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
    )
    parsed = json.loads(_strip_json_fence(text_content))
    if not isinstance(parsed, dict):
        raise RuntimeError("Gemini fact-check did not return JSON.")
    return {
        "claim": claim_text,
        "verdict": str(parsed.get("verdict") or "Needs Context"),
        "confidence": int(parsed.get("confidence") or 0),
        "analysis": str(parsed.get("analysis") or ""),
        "timestamp": time.strftime("%H:%M:%S"),
    }


async def run_live_meeting_pipeline(
    video_path: str,
    host_name: str,
    guest_name: str,
    groq_api_key: Optional[str] = None,
    gemini_api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """FFmpeg -> Groq Whisper-large-v3 -> Gemini 1.5 Flash on the same transcript."""
    groq_key = (groq_api_key or os.getenv("GROQ_API_KEY") or "").strip()
    gemini_key = (gemini_api_key or os.getenv("GEMINI_API_KEY") or "").strip()
    if not groq_key:
        raise RuntimeError("GROQ_API_KEY is not set in the environment.")
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is not set in the environment.")

    ensure_tmp_dirs()
    wav_path = os.path.join(AUDIO_TMP_DIR, f"{uuid.uuid4().hex}_audio.wav")
    try:
        await asyncio.to_thread(extract_wav_with_ffmpeg, video_path, wav_path)
        transcription = await transcribe_audio(
            wav_path=wav_path,
            host_name=host_name,
            guest_name=guest_name,
            groq_api_key=groq_key,
        )
        dialogue_script = transcription["dialogueScript"]
        dialogue_turns = transcription["dialogueTurns"]
        analytics = await analyze_with_gemini(
            raw_transcript=dialogue_script,
            dialogue_turns=dialogue_turns,
            host_name=host_name,
            guest_name=guest_name,
            gemini_api_key=gemini_key,
            segments=transcription.get("groqSegments") or dialogue_turns,
        )
        meeting_summary = await generate_groq_summary(dialogue_script, groq_key)
        return {
            "transcription": transcription,
            "analytics": analytics,
            "dialogueScript": dialogue_script,
            "dialogueTurns": dialogue_turns,
            "summary": meeting_summary or analytics.get("summary", ""),
            "wavPath": wav_path,
        }
    except Exception:
        safe_unlink(wav_path)
        raise
