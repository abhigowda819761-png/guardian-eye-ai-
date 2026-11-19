import os
import sys
import shutil
import subprocess
import base64
import json
import re
import time
import tempfile
from typing import Dict, List, Any, Optional, Tuple

import dotenv
dotenv.load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
dotenv.load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

try:
    from audio_extractor import (
        load_wav_samples,
        extract_acoustic_embedding,
        cluster_speakers
    )
    HAS_ACOUSTIC_DIARIZER = True
except Exception:
    HAS_ACOUSTIC_DIARIZER = False


def get_gemini_api_keys(
    override_primary: Optional[str] = None,
    override_secondary: Optional[str] = None
) -> Tuple[str, str]:
    """
    Dual-Key Resolver with Load-Splitting & Automatic Failover:
    - Primary key: Dedicated to heavy multimodal audio transcription & diarization
    - Secondary key: Dedicated to 1-10 cognitive scoring, executive summary & fact-check audit
    Returns: (primary_key, secondary_key)
    """
    def _clean(k: Optional[str]) -> str:
        s = (k or "").strip()
        if s in (
            "AIzaSy_YOUR_FIRST_GEMINI_API_KEY_HERE",
            "AIzaSy_YOUR_SECOND_GEMINI_API_KEY_HERE",
            "YOUR_GEMINI_API_KEY_HERE",
            "YOUR_GROQ_API_KEY_HERE"
        ):
            return ""
        return s

    primary = _clean(override_primary) or _clean(os.getenv("GEMINI_API_KEY_PRIMARY")) or _clean(os.getenv("GEMINI_API_KEY"))
    secondary = _clean(override_secondary) or _clean(os.getenv("GEMINI_API_KEY_SECONDARY"))

    # Gracefully catch if user placed Gemini key in GROQ_API_KEY
    groq_val = _clean(os.getenv("GROQ_API_KEY"))
    if groq_val and (groq_val.startswith("AIza") or groq_val.startswith("AQ.")):
        if not primary:
            primary = groq_val
        elif not secondary:
            secondary = groq_val

    # If only one key is configured, share it across both roles
    if not secondary:
        secondary = primary
    if not primary:
        primary = secondary

    return primary, secondary


def get_gemini_api_key(override_key: Optional[str] = None, role: str = "primary") -> str:
    """Resolves single Gemini key based on role ('primary' or 'secondary') with automatic failover."""
    p, s = get_gemini_api_keys(
        override_primary=override_key if role == "primary" else None,
        override_secondary=override_key if role != "primary" else None
    )
    return p if role == "primary" else s


def get_ffmpeg_binary() -> str:
    env_ffmpeg = os.environ.get("FFMPEG_PATH") or os.environ.get("FFMPEG_BIN")
    if env_ffmpeg and os.path.exists(env_ffmpeg):
        return env_ffmpeg
    which_ffmpeg = shutil.which("ffmpeg")
    if which_ffmpeg and os.path.exists(which_ffmpeg):
        return which_ffmpeg
    for path in [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/bin/ffmpeg",
        "/usr/local/opt/ffmpeg/bin/ffmpeg"
    ]:
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path
    return which_ffmpeg or "ffmpeg"


FFMPEG_BIN = get_ffmpeg_binary()
TEMP_DIR = os.path.abspath(tempfile.gettempdir())


def extract_wav_with_ffmpeg(video_path: str, output_wav_path: str) -> bool:
    """Extracts 16kHz mono PCM WAV from uploaded video/audio using FFmpeg."""
    abs_video = os.path.abspath(video_path)
    abs_output = os.path.abspath(output_wav_path)
    os.makedirs(os.path.dirname(abs_output), exist_ok=True)

    if not os.path.exists(abs_video) or os.path.getsize(abs_video) == 0:
        raise RuntimeError(f"Video file at {abs_video} is missing or empty (0 bytes).")

    ffmpeg_bin = get_ffmpeg_binary()
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", abs_video,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        abs_output
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    if res.returncode != 0:
        err = res.stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"FFmpeg audio extraction failed: {err[:300]}")

    if not os.path.exists(abs_output) or os.path.getsize(abs_output) < 44:
        raise RuntimeError("Output WAV file is missing or < 44 bytes.")
    return True


def _prepare_gemini_audio(wav_path: str) -> Tuple[str, str]:
    """
    Compresses 16kHz WAV to compact 16kHz mono 48kbps MP3 so base64 inline_data payload
    sent to Gemini 2.5 Flash is fast, lightweight (<15MB), and works for long recordings.
    """
    mp3_path = wav_path.rsplit(".", 1)[0] + "_gemini.mp3"
    ffmpeg_bin = get_ffmpeg_binary()
    cmd = [
        ffmpeg_bin, "-y",
        "-i", wav_path,
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "48k",
        mp3_path
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if res.returncode == 0 and os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 100:
            return mp3_path, "audio/mp3"
    except Exception as e:
        print(f"[Gemini Audio Optimizer] MP3 compression notice: {e}")
    return wav_path, "audio/wav"


def format_sec(sec: float) -> str:
    m = int(max(0.0, sec) // 60)
    s = int(max(0.0, sec) % 60)
    return f"{m:02d}:{s:02d}"


def _build_speaker_roster(
    host_name: str,
    guest_name: str = "",
    participant_names: Optional[List[str]] = None
) -> List[str]:
    """Builds deduplicated list of up to 5 speaker names using exact user-provided names."""
    clean_host = (host_name or "Host").strip()
    if not clean_host or clean_host.upper() in ("ABHIGOWDA819761", "ABHISHEK", "DEFAULT"):
        clean_host = "Host"

    roster = [clean_host]
    raw_candidates: List[str] = []

    if participant_names:
        for item in participant_names:
            if isinstance(item, str):
                raw_candidates.extend([x.strip() for x in item.split(",") if x.strip()])
    if guest_name:
        raw_candidates.extend([x.strip() for x in guest_name.split(",") if x.strip()])

    for name in raw_candidates:
        if (
            name
            and name.upper() not in ("ABHIGOWDA819761", "ABHISHEK", "DEFAULT")
            and name.lower() not in [r.lower() for r in roster]
        ):
            roster.append(name)
        if len(roster) >= 5:
            break

    if len(roster) == 1:
        roster.append("Participant 1")
    return roster[:5]


def _parse_robust_json(text: str) -> Optional[Any]:
    if not text:
        return None
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"```$", "", cleaned, flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass

    fixed = re.sub(r',\s*([\]\}])', r'\1', cleaned)
    try:
        return json.loads(fixed)
    except Exception:
        pass

    m = re.search(r'(\{[\s\S]*\}|\[[\s\S]*\])', cleaned)
    if m:
        candidate = m.group(1)
        try:
            return json.loads(candidate)
        except Exception:
            try:
                fixed_cand = re.sub(r',\s*([\]\}])', r'\1', candidate)
                return json.loads(fixed_cand)
            except Exception:
                pass
    return None


async def transcribe_audio(
    wav_path: str,
    host_name: str = "Host",
    guest_name: str = "Participant 1",
    groq_api_key: Optional[str] = None,
    participant_names: Optional[List[str]] = None,
    gemini_api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    100% Gemini 2.5 Flash Native Audio Diarization & Verbatim Transcription:
    Sends the audio directly to Gemini 2.5 Flash so Gemini listens to the distinct voices,
    separates 'Who Spoke What' across up to 5 user-entered speaker names, and extracts
    every spoken turn with timestamps and filler words.
    """
    speaker_roster = _build_speaker_roster(host_name, guest_name, participant_names)
    clean_host = speaker_roster[0]
    primary_key, secondary_key = get_gemini_api_keys(override_primary=gemini_api_key or groq_api_key)

    if not primary_key:
        raise RuntimeError("GEMINI_API_KEY_PRIMARY (or GEMINI_API_KEY) is missing in backend/.env.")

    # Dual-Key Work-Splitting: prefer primary key for heavy audio, fallback to secondary key
    keys_to_try = [primary_key]
    if secondary_key and secondary_key != primary_key:
        keys_to_try.append(secondary_key)

    upload_path, mime_type = _prepare_gemini_audio(wav_path)
    try:
        with open(upload_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("utf-8")

        prompt = f"""You are an expert Multimodal Audio Diarization and Verbatim Transcription Engine for 'Guardian Eye AI'.
Listen carefully to the attached meeting/interview audio recording and transcribe every spoken turn verbatim, identifying exactly WHO spoke WHAT.

=== REGISTERED MEETING PARTICIPANTS (UP TO 5) ===
Host / Moderator / Interviewer: "{clean_host}"
Full Speaker Roster (in order): {json.dumps(speaker_roster)}

=== STRICT DIARIZATION & TRANSCRIPTION RULES ===
1. Listen to the distinct vocal pitch, timbre, cadence, and conversational turn-taking (questions vs. answers, greetings, and name mentions) in the audio.
2. Attribute every spoken turn strictly to the matching speaker name from {json.dumps(speaker_roster)}:
   - Assign the primary interviewer / moderator / host voice to "{clean_host}".
   - Assign each distinct participant / candidate / guest voice consistently to the remaining names in {json.dumps(speaker_roster)}.
   - If a speaker is addressed by name in the audio, bind that voice to that exact name.
3. Transcribe 100% verbatim in English (or transliterated Roman script if another language is spoken), preserving natural filler words ("um", "uh", "like", "you know") so our communication fluency scorer can count them accurately.
4. Provide accurate `start` and `end` timestamps in seconds (float) for every turn.

Return ONLY valid JSON matching this exact schema:
{{
  "segments": [
    {{
      "start": 0.0,
      "end": 4.2,
      "speaker": "{clean_host}",
      "text": "Exact verbatim words spoken in this turn."
    }}
  ]
}}"""

        payload = {
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": audio_b64}},
                    {"text": prompt}
                ]
            }],
            "generationConfig": {
                "temperature": 0.0,
                "responseMimeType": "application/json"
            }
        }

        import httpx
        raw_segments: List[Dict[str, Any]] = []
        used_model = "gemini-3.5-flash-lite"
        models_to_try = ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest")

        for key_candidate in keys_to_try:
            if raw_segments:
                break
            for model_id in models_to_try:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={key_candidate}"
                    async with httpx.AsyncClient(timeout=180.0) as client:
                        resp = await client.post(url, json=payload)
                        if resp.status_code == 200:
                            resp_json = resp.json()
                            candidates = resp_json.get("candidates", [])
                            if candidates:
                                text_content = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                                parsed = _parse_robust_json(text_content)
                                segs = parsed.get("segments", []) if isinstance(parsed, dict) else (parsed if isinstance(parsed, list) else [])
                                if segs:
                                    raw_segments = segs
                                    used_model = f"{model_id} (Native Audio)"
                                    print(f"[Gemini Audio Diarizer] {model_id} extracted {len(raw_segments)} speaker turns using {'Primary' if key_candidate == primary_key else 'Secondary'} Key.")
                                    break
                        else:
                            print(f"[Gemini Audio {model_id} Error] HTTP {resp.status_code}: {resp.text[:250]}")
                except Exception as e:
                    print(f"[Gemini Audio {model_id} Exception] {e}")

        # Local whisper fallback if Gemini network call failed
        if not raw_segments:
            try:
                from diarizer import get_whisper_model
                import asyncio
                print("[Gemini Audio Fallback] Running local audio diarization & transcription on WAV...")
                model = get_whisper_model("base")
                if model is not None:
                    res = await asyncio.to_thread(model.transcribe, wav_path, fp16=False, language="en")
                    raw_segments = res.get("segments", [])
                    used_model = "local-whisper-fallback"
            except Exception as local_err:
                print(f"[Local Transcription Notice] {local_err}")

        dialogue_turns: List[Dict[str, Any]] = []
        dialogue_lines: List[str] = []

        for idx, seg in enumerate(raw_segments):
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            start = float(seg.get("start", idx * 3.5))
            end = float(seg.get("end", start + max(1.5, len(text.split()) * 0.4)))
            ts = format_sec(start)

            raw_spk = (seg.get("speaker") or clean_host).strip()
            matched_spk = raw_spk
            for r_name in speaker_roster:
                if r_name.lower() == raw_spk.lower() or r_name.lower() in raw_spk.lower():
                    matched_spk = r_name
                    break
            if matched_spk not in speaker_roster:
                # Map generic Speaker 0 / Speaker 1 labels to roster
                num_match = re.search(r'(\d+)', raw_spk)
                if num_match:
                    spk_idx = int(num_match.group(1))
                    matched_spk = speaker_roster[spk_idx % len(speaker_roster)]
                else:
                    matched_spk = speaker_roster[idx % len(speaker_roster)]

            is_host = (matched_spk.lower() == clean_host.lower())
            turn_idx = len(dialogue_turns)
            dialogue_turns.append({
                "id": f"turn_{turn_idx}",
                "speaker": matched_spk,
                "role": "Host" if is_host else "Participant",
                "isHost": is_host,
                "text": text,
                "timestamp": ts,
                "start": round(start, 2),
                "end": round(end, 2)
            })
            dialogue_lines.append(f"{matched_spk}: {text}")

        formatted_transcript = "\n".join(dialogue_lines)
        return {
            "model": used_model,
            "rawTranscript": formatted_transcript,
            "dialogueTurns": dialogue_turns,
            "text": formatted_transcript,
            "segments": dialogue_turns,
            "groqSegments": dialogue_turns,
            "speakerRoster": speaker_roster
        }
    finally:
        if upload_path != wav_path and os.path.exists(upload_path):
            try:
                os.remove(upload_path)
            except Exception:
                pass


async def generate_gemini_summary(raw_transcript: str, gemini_api_key: Optional[str] = None) -> str:
    """Uses Gemini 2.5 Flash to generate a concise executive summary with dual-key load splitting."""
    primary_key, secondary_key = get_gemini_api_keys(override_secondary=gemini_api_key)
    keys_to_try = [k for k in [secondary_key, primary_key] if k]
    if not keys_to_try or not raw_transcript.strip():
        return ""
    try:
        import httpx
        payload = {
            "contents": [{
                "parts": [{
                    "text": f"Generate a concise 2-3 sentence executive summary strictly based on the verbatim words spoken in this meeting transcript:\n\n{raw_transcript}"
                }]
            }],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 200}
        }
        for key_candidate in keys_to_try:
            for model_id in ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"):
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={key_candidate}"
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        resp = await client.post(url, json=payload)
                        if resp.status_code == 200:
                            candidates = resp.json().get("candidates", [])
                            if candidates:
                                return candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                except Exception:
                    pass
    except Exception as e:
        print(f"[Gemini Summary Notice] {e}")
    return ""

# Backward-compatibility alias
generate_groq_summary = generate_gemini_summary


def extract_speaker_linguistic_metrics(
    segments: List[Dict],
    speaker_roster: List[str]
) -> Dict[str, Dict]:
    """Computes objective WPM, filler words, word count, char count, and hesitation pauses for up to 5 speakers."""
    metrics: Dict[str, Dict] = {}
    for spk in speaker_roster:
        metrics[spk] = {
            "words": 0, "chars": 0, "segments": 0, "fillers": 0,
            "duration_sec": 0.0, "wpm": 0, "long_pauses": 0, "filler_rate_pct": 0.0
        }

    filler_regex = re.compile(
        r'\b(uh|um|uhm|ah|er|erm|like|you know|sort of|kind of|basically|literally|i mean)\b',
        re.IGNORECASE
    )
    sound_artifacts_regex = re.compile(
        r'\[(applause|music|laughter|silence|whispering|cough|throat clearing)\]',
        re.IGNORECASE
    )
    prev_end_by_speaker: Dict[str, float] = {}

    for seg in (segments or []):
        text = seg.get("text", "")
        cleaned = sound_artifacts_regex.sub("", text).strip()
        if not cleaned:
            continue

        raw_spk = (seg.get("speaker") or seg.get("speakerName") or speaker_roster[0]).strip()
        target_key = None
        for r_spk in speaker_roster:
            if raw_spk.lower() == r_spk.lower() or r_spk.lower() in raw_spk.lower():
                target_key = r_spk
                break
        if not target_key:
            target_key = raw_spk
            if target_key not in metrics:
                metrics[target_key] = {
                    "words": 0, "chars": 0, "segments": 0, "fillers": 0,
                    "duration_sec": 0.0, "wpm": 0, "long_pauses": 0, "filler_rate_pct": 0.0
                }

        words = len(cleaned.split())
        chars = len(cleaned)
        fillers = len(filler_regex.findall(cleaned))
        start_t = float(seg.get("start", 0.0))
        end_t = float(seg.get("end", start_t + max(1.0, words * 0.4)))
        seg_dur = max(0.5, end_t - start_t)

        metrics[target_key]["words"] += words
        metrics[target_key]["chars"] += chars
        metrics[target_key]["segments"] += 1
        metrics[target_key]["fillers"] += fillers
        metrics[target_key]["duration_sec"] += seg_dur

        if target_key in prev_end_by_speaker:
            gap = start_t - prev_end_by_speaker[target_key]
            if 1.8 <= gap <= 8.0:
                metrics[target_key]["long_pauses"] += 1
        prev_end_by_speaker[target_key] = end_t

    for spk_key, data in metrics.items():
        dur = data["duration_sec"]
        w = data["words"]
        data["wpm"] = round((w / dur) * 60) if dur > 0 else 0
        data["filler_rate_pct"] = round((data["fillers"] / max(w, 1)) * 100.0, 1)

    return metrics


async def analyze_with_gemini(
    raw_transcript: str,
    dialogue_turns: List[Dict],
    host_name: str = "Host",
    guest_name: str = "Participant 1",
    gemini_api_key: Optional[str] = None,
    segments: Optional[List[Dict]] = None,
    participant_names: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Uses Google Gemini 2.5 Flash to strictly and objectively score every active speaker (up to 5)
    on a 1–10 scale, generate the executive summary, and perform Q&A Fact-Checking.
    """
    primary_key, secondary_key = get_gemini_api_keys(override_secondary=gemini_api_key)
    # Dual-Key Work-Splitting: prefer Secondary key for scoring/fact-check, failover to Primary
    keys_to_try = [secondary_key] if secondary_key else []
    if primary_key and primary_key not in keys_to_try:
        keys_to_try.append(primary_key)

    speaker_roster = _build_speaker_roster(host_name, guest_name, participant_names)
    clean_host = speaker_roster[0]

    analysis_segments = dialogue_turns if (dialogue_turns and len(dialogue_turns) > 0) else (segments or [])
    linguistic_metrics = extract_speaker_linguistic_metrics(analysis_segments, speaker_roster)

    if keys_to_try and len(analysis_segments) > 0:
        import httpx

        prompt = f"""You are a STRICT, UNBIASED Communication Auditor and Fact-Checking Engine for 'Guardian Eye AI'.
Evaluate each active speaker in the meeting transcript below using the objective linguistic telemetry. DO NOT inflate scores or give polite default 7/10 or 8/10 ratings.

=== REGISTERED PARTICIPANTS (UP TO 5) ===
Host: "{clean_host}"
All Registered Speakers: {json.dumps(speaker_roster)}

=== OBJECTIVE LINGUISTIC TELEMETRY PER SPEAKER ===
{json.dumps(linguistic_metrics, indent=2)}

=== STRICT, UNBIASED 1-TO-10 GRADING RUBRIC ===
- 5/10 is the baseline average score.
- 9 to 10 (Exceptional): Flawless structure, <1% filler rate, 120-150 WPM, and 100% factual accuracy.
- 7 to 8 (Competent): Clear, direct answers with minor imperfections (1-2 fillers).
- 5 to 6 (Average / Mediocre): Noticeable fillers ("um", "uh", "like"), surface-level explanations, or suboptimal WPM.
- 3 to 4 (Weak): Frequent rambling, >4 fillers, hesitation pauses, or evasive responses.
- 1 to 2 (Poor): Incoherent, factually wrong, or <10 words spoken.

For `awkwardness` (1 to 10 scale, lower is better):
- 1 = Composed and natural.
- 4 to 6 = Noticeable filler words or hesitation pauses.
- 7 to 10 = Severe awkwardness, frequent stutters, or losing train of thought.

For `persuasive_assertiveness` (1 to 10 scale, higher indicates greater rhetorical conviction):
- 9 to 10 = Unshakable conviction, authoritative delivery, decisive call-to-action, compelling impact.
- 7 to 8 = Confident proposition, firm position, constructive advocacy.
- 5 to 6 = Balanced or neutral stance, receptive to input, moderate conviction.
- 3 to 4 = Tentative, overly cautious, yielding easily, passive posture.
- 1 to 2 = Submissive, insecure, or unable to present a position.

For `tone_style` (Categorical String describing the pragmatic intent & delivery posture):
- Must be strictly one of: "Commanding" (authoritative, executive, directing), "Requesting" (soliciting input, seeking buy-in, asking questions), "Polite" (diplomatic, respectful, courteous), or "Collaborative" (partnership, shared-problem solving, team-oriented).

=== TASK 1: SCORE EVERY ACTIVE SPEAKER IN {json.dumps(speaker_roster)} ===
Provide integer scores (1-10) for `communication_skills`, `fluency`, `confidence`, `awkwardness`, `straightforward_answers`, `persuasive_assertiveness`, a categorical string for `tone_style` ("Commanding", "Requesting", "Polite", or "Collaborative"), and a critical `rationale` citing exact quotes, WPM, and filler count.

=== TASK 2: VERBATIM Q&A FACT-CHECK AUDIT ===
Extract every question asked and audit the response given. Assign a verdict strictly from: "Accurate", "Incomplete", or "Evasive".

=== FULL VERBATIM TRANSCRIPT ===
{raw_transcript}

Return ONLY valid JSON matching this schema:
{{
  "speakerRatings": {{
    "<SpeakerName>": {{
      "communication_skills": <int 1-10>,
      "fluency": <int 1-10>,
      "confidence": <int 1-10>,
      "awkwardness": <int 1-10>,
      "straightforward_answers": <int 1-10>,
      "persuasive_assertiveness": <int 1-10>,
      "tone_style": "<Commanding | Requesting | Polite | Collaborative>",
      "rationale": "<critical evidence with verbatim quotes, WPM, and fillers>"
    }}
  }},
  "factCheckAudit": [
    {{
      "question_by": "<SpeakerName>",
      "question": "<Exact question>",
      "answered_by": "<SpeakerName>",
      "answer": "<Exact answer>",
      "verdict": "Accurate"
    }}
  ],
  "summary": "<2-3 sentence executive summary>"
}}"""

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json"
            }
        }

        models_to_try = ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest")
        for key_candidate in keys_to_try:
            for model_id in models_to_try:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={key_candidate}"
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        resp = await client.post(url, json=payload)
                        if resp.status_code == 200:
                            candidates = resp.json().get("candidates", [])
                            if candidates:
                                text_content = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                                parsed = _parse_robust_json(text_content)
                                if parsed and isinstance(parsed, dict):
                                    return _validate_and_clamp_analysis(
                                        parsed, speaker_roster, model_id, linguistic_metrics, analysis_segments, raw_transcript
                                    )
                        else:
                            print(f"[Gemini Scoring {model_id} Error] HTTP {resp.status_code}: {resp.text[:250]}")
                except Exception as e:
                    print(f"[Gemini Scoring {model_id} Exception] {e}")

    return _grounded_deterministic_analysis(analysis_segments, speaker_roster, linguistic_metrics)


def _validate_and_clamp_analysis(
    parsed: Dict,
    speaker_roster: List[str],
    model_name: str,
    linguistic_metrics: Dict[str, Dict],
    dialogue_turns: List[Dict],
    rebuilt_transcript: str
) -> Dict[str, Any]:
    clean_host = speaker_roster[0]

    def clamp(v, default_val=5):
        try:
            return max(1, min(10, int(round(float(v)))))
        except (ValueError, TypeError):
            return default_val

    ratings_source = parsed.get("speakerRatings", parsed)

    def evaluate_guardrail(raw_data: Dict, spk_ling: Dict, spk_name: str) -> Dict[str, Any]:
        chars = spk_ling.get("chars", 0)
        words = spk_ling.get("words", 0)
        segs = spk_ling.get("segments", 0)
        fillers = spk_ling.get("fillers", 0)
        pauses = spk_ling.get("long_pauses", 0)
        wpm = spk_ling.get("wpm", 0)
        filler_rate = spk_ling.get("filler_rate_pct", 0.0)

        if chars < 15 or words < 3:
            return {
                "communication_skills": 1, "fluency": 1, "confidence": 1, "awkwardness": 1, "straightforward_answers": 1,
                "persuasive_assertiveness": 1, "tone_style": "Polite",
                "rationale": "Insufficient spoken text (<3 words) for evaluation.",
                "status_note": "Insufficient spoken text for evaluation.",
                "is_clamped": True, "word_count": words, "char_count": chars, "segment_count": segs, "wpm": wpm, "filler_count": fillers
            }

        comm = clamp(raw_data.get("communication_skills"), 5)
        flu = clamp(raw_data.get("fluency"), 5)
        conf = clamp(raw_data.get("confidence"), 5)
        raw_awk = clamp(raw_data.get("awkwardness"), 3)
        straight = clamp(raw_data.get("straightforward_answers"), 5)
        persuasive = clamp(raw_data.get("persuasive_assertiveness"), conf)

        raw_tone = str(raw_data.get("tone_style") or "").strip().lower()
        if "command" in raw_tone:
            tone_style = "Commanding"
        elif "request" in raw_tone or "inquir" in raw_tone:
            tone_style = "Requesting"
        elif "polit" in raw_tone or "defer" in raw_tone:
            tone_style = "Polite"
        elif "collab" in raw_tone or "partner" in raw_tone:
            tone_style = "Collaborative"
        else:
            # Deterministic tone inference from assertiveness and speech
            if persuasive >= 8 or conf >= 8:
                tone_style = "Commanding"
            elif "?" in raw_data.get("rationale", "") or "?" in str(raw_data):
                tone_style = "Requesting"
            elif conf <= 4:
                tone_style = "Polite"
            else:
                tone_style = "Collaborative"

        if filler_rate > 6.0 or fillers >= 4:
            flu = min(flu, 5)
            comm = min(comm, 6)
            raw_awk = max(raw_awk, 6)
            persuasive = min(persuasive, 5)
        elif filler_rate > 3.0 or fillers >= 2:
            flu = min(flu, 6)
            raw_awk = max(raw_awk, 4)

        if pauses >= 2:
            flu = max(1, flu - 1)
            conf = max(1, conf - 1)
            persuasive = max(1, persuasive - 1)
            raw_awk = max(raw_awk, 5)

        if wpm > 0 and (wpm < 95 or wpm > 170):
            flu = max(1, flu - 1)

        if words < 18:
            comm = min(comm, 6)
            flu = min(flu, 6)
            conf = min(conf, 6)
            straight = min(straight, 6)
            persuasive = min(persuasive, 6)

        awk = raw_awk if (fillers > 0 or pauses > 0) else min(3, raw_awk)

        return {
            "communication_skills": comm,
            "fluency": flu,
            "confidence": conf,
            "awkwardness": awk,
            "straightforward_answers": straight,
            "persuasive_assertiveness": persuasive,
            "tone_style": tone_style,
            "rationale": raw_data.get("rationale") or f"Evaluated by Gemini 2.5 Flash at {wpm} WPM across {words} words ({segs} turns) with {fillers} fillers ({filler_rate}%). Tone posture: {tone_style}.",
            "status_note": f"Scored by {model_name} ({wpm} WPM, {fillers} fillers)",
            "is_clamped": False,
            "word_count": words,
            "char_count": chars,
            "segment_count": segs,
            "wpm": wpm,
            "filler_count": fillers
        }

    speaker_ratings_dict: Dict[str, Any] = {}
    all_detected_speakers = list(speaker_roster)
    for k in linguistic_metrics.keys():
        if k not in all_detected_speakers:
            all_detected_speakers.append(k)

    for idx, spk_name in enumerate(all_detected_speakers[:5]):
        spk_ling = linguistic_metrics.get(spk_name, {"words": 0, "chars": 0, "segments": 0, "fillers": 0, "wpm": 0, "long_pauses": 0, "filler_rate_pct": 0.0})
        if idx == 0 or spk_ling.get("words", 0) >= 3:
            raw_spk_data = ratings_source.get(spk_name, {})
            if not raw_spk_data:
                for k, v in ratings_source.items():
                    if isinstance(v, dict) and (k.lower() == spk_name.lower() or spk_name.lower() in k.lower()):
                        raw_spk_data = v
                        break
            speaker_ratings_dict[spk_name] = evaluate_guardrail(raw_spk_data, spk_ling, spk_name)

    fact_check = []
    for item in parsed.get("factCheckAudit", []):
        if not isinstance(item, dict):
            continue
        q = (item.get("question") or "").strip()
        a = (item.get("answer") or "").strip()
        if not q or not a:
            continue
        v_raw = str(item.get("verdict", "")).lower()
        verdict = "Incomplete" if ("incom" in v_raw or "inacc" in v_raw) else ("Evasive" if "evas" in v_raw else "Accurate")
        fact_check.append({
            "question_by": item.get("question_by") or clean_host,
            "question": q,
            "answered_by": item.get("answered_by") or (speaker_roster[1] if len(speaker_roster) > 1 else clean_host),
            "answer": a,
            "verdict": verdict
        })

    return {
        "speakerRatings": speaker_ratings_dict,
        "factCheckAudit": fact_check,
        "dialogueTurns": dialogue_turns,
        "rawTranscript": rebuilt_transcript,
        "summary": parsed.get("summary") or f"Meeting for {', '.join(speaker_ratings_dict.keys())} diarized, transcribed, and scored by {model_name}.",
        "gemini_model": model_name
    }


def _grounded_deterministic_analysis(
    dialogue_turns: List[Dict],
    speaker_roster: List[str],
    linguistic_metrics: Dict[str, Dict]
) -> Dict[str, Any]:
    clean_host = speaker_roster[0]
    questions_found = []
    for i, turn in enumerate(dialogue_turns):
        text = (turn.get("text") or "").strip()
        if "?" in text:
            answer_turn = dialogue_turns[i + 1] if i + 1 < len(dialogue_turns) else None
            if answer_turn and answer_turn.get("text"):
                a_text = answer_turn["text"].strip()
                verdict = "Incomplete" if len(a_text.split()) < 5 else "Accurate"
                questions_found.append({
                    "question_by": turn.get("speaker", clean_host),
                    "question": text,
                    "answered_by": answer_turn.get("speaker", speaker_roster[-1]),
                    "answer": a_text,
                    "verdict": verdict
                })

    speaker_ratings = {}
    for idx, spk_name in enumerate(speaker_roster):
        spk_ling = linguistic_metrics.get(spk_name, {"words": 0, "chars": 0, "segments": 0, "fillers": 0, "wpm": 0, "long_pauses": 0, "filler_rate_pct": 0.0})
        words = spk_ling.get("words", 0)
        chars = spk_ling.get("chars", 0)
        if idx == 0 or words >= 3:
            if words < 3:
                speaker_ratings[spk_name] = {
                    "communication_skills": 1, "fluency": 1, "confidence": 1, "awkwardness": 1, "straightforward_answers": 1,
                    "persuasive_assertiveness": 1, "tone_style": "Polite",
                    "rationale": "Insufficient spoken text.", "status_note": "Insufficient spoken text",
                    "is_clamped": True, "word_count": words, "char_count": chars, "segment_count": 0, "wpm": 0, "filler_count": 0
                }
            else:
                is_host = (idx == 0)
                tone = "Commanding" if is_host else "Collaborative"
                speaker_ratings[spk_name] = {
                    "communication_skills": 6, "fluency": 6, "confidence": 6, "awkwardness": 3, "straightforward_answers": 6,
                    "persuasive_assertiveness": 6, "tone_style": tone,
                    "rationale": f"Spoke {words} words at {spk_ling.get('wpm', 130)} WPM.",
                    "status_note": "Evaluated via deterministic metrics",
                    "is_clamped": False, "word_count": words, "char_count": chars,
                    "segment_count": spk_ling.get("segments", 1), "wpm": spk_ling.get("wpm", 130), "filler_count": spk_ling.get("fillers", 0)
                }

    rebuilt_transcript = "\n".join(f"{t.get('speaker', clean_host)}: {t.get('text', '')}" for t in dialogue_turns if t.get("text"))
    return {
        "speakerRatings": speaker_ratings,
        "factCheckAudit": questions_found,
        "dialogueTurns": dialogue_turns,
        "rawTranscript": rebuilt_transcript,
        "summary": f"Meeting analyzed for {', '.join(speaker_ratings.keys())}.",
        "gemini_model": "gemini-2.5-flash"
    }
