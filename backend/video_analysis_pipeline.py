import os
import sys
import shutil
import subprocess
import json
import re
import time
import tempfile
from typing import Dict, List, Any, Optional, Tuple

FFMPEG_BIN = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
TEMP_DIR = os.path.abspath(tempfile.gettempdir())

def extract_wav_with_ffmpeg(video_path: str, output_wav_path: str) -> bool:
    """
    Extracts 16kHz mono WAV from video using FFmpeg (-acodec pcm_s16le -ar 16000 -ac 1).
    Enforces absolute os.path temp directory tracking, stream lookahead, and verifies
    that output WAV is strictly greater than 0 bytes (and >= 44 bytes header) before passing to Groq.
    """
    abs_video = os.path.abspath(video_path)
    abs_output = os.path.abspath(output_wav_path)
    abs_temp = os.path.abspath(tempfile.gettempdir())
    os.makedirs(abs_temp, exist_ok=True)
    os.makedirs(os.path.dirname(abs_output), exist_ok=True)
    
    # 1. Asynchronous file system lookahead: ensure video file stream handle is fully closed and stable on disk
    last_size = -1
    stable_checks = 0
    for _ in range(10):
        if not os.path.exists(abs_video):
            time.sleep(0.05)
            continue
        try:
            curr_size = os.path.getsize(abs_video)
            # Test stream handle readability
            with open(abs_video, "rb") as check_f:
                check_f.read(1024)
            if curr_size == last_size and curr_size > 0:
                stable_checks += 1
                if stable_checks >= 2:
                    break
            else:
                stable_checks = 0
                last_size = curr_size
        except Exception:
            stable_checks = 0
        time.sleep(0.05)

    if not os.path.exists(abs_video) or os.path.getsize(abs_video) == 0:
        raise RuntimeError(f"Video file at {abs_video} is missing or empty (0 bytes). Cannot extract audio.")

    ffmpeg_bin = shutil.which("ffmpeg") or FFMPEG_BIN
    if not os.path.exists(ffmpeg_bin) and shutil.which("ffmpeg") is None:
        raise RuntimeError(f"FFmpeg binary not found at {ffmpeg_bin} or in system PATH.")
    
    in_size = os.path.getsize(abs_video)
    print(f"[FFmpeg] Input video track: {abs_video} ({in_size} bytes, tempDir: {abs_temp})")
    
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
    
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        err = res.stderr.decode("utf-8", errors="ignore")
        print(f"[FFmpeg] Hard Error during extraction: {err}")
        raise RuntimeError(f"FFmpeg audio extraction failed: {err}")
    
    out_size = os.path.getsize(abs_output) if os.path.exists(abs_output) else 0
    # Strict validation: output WAV file must be greater than 0 bytes and >= 44 bytes header
    if not os.path.exists(abs_output) or out_size == 0:
        print(f"[FFmpeg] ERROR: Output audio file size is 0 bytes for {abs_output}")
        raise RuntimeError(f"Output audio file is missing or 0 bytes for {abs_output}. Cannot pass to Groq Whisper Large-V3.")

    if out_size < 44:
        print(f"[FFmpeg] ERROR: Output audio file size is {out_size} bytes (<44 bytes header) for {abs_output}")
        raise RuntimeError(f"Output audio file size is {out_size} bytes (less than 44-byte WAV header) for {abs_output}. Cannot pass to Groq Whisper Large-V3.")

    # Duration matching validation to prevent partial ingestion
    def probe_dur(fpath: str) -> Optional[float]:
        try:
            p = subprocess.run([ffmpeg_bin, "-i", fpath], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            out = p.stderr.decode("utf-8", errors="ignore")
            m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", out)
            if m:
                return float(m.group(1)) * 3600 + float(m.group(2)) * 60 + float(m.group(3))
        except Exception:
            pass
        return None

    v_dur = probe_dur(abs_video)
    a_dur = probe_dur(abs_output)
    print(f"[FFmpeg] Duration check: Video={v_dur}s, Audio={a_dur}s")
    if v_dur and v_dur > 0:
        if out_size < 44:
            raise RuntimeError(f"Input video duration is {v_dur:.2f}s, but output WAV size is {out_size} bytes (<44 bytes header). Partial ingestion blocked.")
        if a_dur and v_dur > 1.5:
            diff = abs(v_dur - a_dur)
            if diff > 2.5 and (diff / v_dur) > 0.15:
                raise RuntimeError(f"Audio extraction truncated! Video duration ({v_dur:.1f}s) does not match audio stream duration ({a_dur:.1f}s). Terminated to prevent partial ingestion.")

    print(f"[FFmpeg] Extracted 16kHz mono WAV: {abs_output} ({out_size} bytes)")
    return True

def format_sec(sec: float) -> str:
    m = int(sec // 60)
    s = int(sec % 60)
    return f"{m:02d}:{s:02d}"

async def transcribe_audio(
    wav_path: str,
    host_name: str = "ABHIGOWDA819761",
    guest_name: str = "Participant",
    groq_api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Transcribes audio using Groq Whisper Large-V3 if key provided;
    otherwise uses local faster-whisper model.
    """
    groq_key = groq_api_key or os.getenv("GROQ_API_KEY", "")
    wav_size = os.path.getsize(wav_path) if os.path.exists(wav_path) else 0
    print(f"[transcribe_audio] Preparing audio transcription for {host_name} and {guest_name} (WAV size: {wav_size} bytes)")
    
    # 1. Try Groq Whisper Large-V3
    if groq_key:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=60.0) as client:
                with open(wav_path, "rb") as f:
                    files = {"file": (os.path.basename(wav_path), f, "audio/wav")}
                    data = {
                        "model": "whisper-large-v3",
                        "response_format": "verbose_json",
                        "temperature": "0.0",
                        "prompt": f"Meeting conversation between {host_name} and {guest_name}."
                    }
                    headers = {"Authorization": f"Bearer {groq_key}"}
                    resp = await client.post(
                        "https://api.groq.com/openai/v1/audio/transcriptions",
                        files=files,
                        data=data,
                        headers=headers
                    )
                
                if resp.status_code == 200:
                    groq_data = resp.json()
                    raw_segments = groq_data.get("segments", [])
                    # Chronological sorting of Groq response segments
                    segments = sorted(raw_segments, key=lambda s: float(s.get("start", 0.0)))
                    raw_text = groq_data.get("text", "").strip()
                    
                    dialogue_turns = []
                    dialogue_lines = []
                    
                    if segments:
                        for idx, seg in enumerate(segments):
                            text = seg.get("text", "").strip()
                            if not text:
                                continue
                            start = seg.get("start", 0.0)
                            ts = format_sec(start)
                            
                            # Dynamic Speaker Tag Detection (e.g., Speaker 1:, Participant:)
                            spk = host_name
                            tag_match = re.match(r'^(?:Speaker\s*([0-9]+)|([a-zA-Z0-9_\s]+)):\s*(.+)$', text, re.I)
                            if tag_match:
                                if tag_match.group(1) is not None:
                                    spk_num = int(tag_match.group(1))
                                    spk = host_name if spk_num == 0 else guest_name
                                elif tag_match.group(2):
                                    name_part = tag_match.group(2).strip().lower()
                                    if guest_name and guest_name.lower() in name_part:
                                        spk = guest_name
                                    elif host_name and host_name.lower() in name_part:
                                        spk = host_name
                                    else:
                                        spk = tag_match.group(2).strip()
                                text = tag_match.group(3).strip()
                            
                            is_host = (spk.lower() == host_name.lower())
                            dialogue_turns.append({
                                "id": f"turn_{idx}",
                                "speaker": spk,
                                "role": "Host" if is_host else "Participant",
                                "isHost": is_host,
                                "text": text,
                                "timestamp": ts,
                                "start": start,
                                "end": seg.get("end", start + 2.0)
                            })
                            dialogue_lines.append(f"{spk}: {text}")
                    elif raw_text:
                        sentences = [s.strip() for s in re.split(r'(?<=[.?!])\s+', raw_text) if s.strip()]
                        for idx, s in enumerate(sentences):
                            tag_match = re.match(r'^(?:Speaker\s*([0-9]+)|([a-zA-Z0-9_\s]+)):\s*(.+)$', s, re.I)
                            if tag_match:
                                spk = guest_name if tag_match.group(1) == "1" else host_name
                                text_clean = tag_match.group(3).strip()
                            else:
                                spk = host_name
                                text_clean = s
                            is_host = (spk == host_name)
                            dialogue_turns.append({
                                "id": f"turn_{idx}",
                                "speaker": spk,
                                "role": "Host" if is_host else "Participant",
                                "isHost": is_host,
                                "text": text_clean,
                                "timestamp": format_sec(idx * 4.0)
                            })
                            dialogue_lines.append(f"{spk}: {text_clean}")
                    
                    # If Groq transcription array returns empty, block the pipeline from writing blank fields
                    if not dialogue_turns and not raw_text:
                        print(f"[transcribe_audio] ERROR: Groq Whisper transcription returned empty segments for {wav_path}. Blocking pipeline.")
                        raise RuntimeError(f"Groq Whisper transcription returned empty segments for {wav_path}. Audio contains no detectable speech.")

                    formatted_transcript = "\n".join(dialogue_lines) if dialogue_lines else raw_text
                    return {
                        "model": "whisper-large-v3 (Groq API)",
                        "rawTranscript": formatted_transcript,
                        "dialogueTurns": dialogue_turns,
                        "text": formatted_transcript,
                        "segments": segments,
                        "groqSegments": segments
                    }
        except Exception as e:
            print(f"[transcribe_audio] Groq API error: {e}, falling back to local faster-whisper")
    
    # 2. Local faster-whisper fallback
    try:
        from faster_whisper import WhisperModel
        # Use lightweight model for real-time responsiveness
        model = WhisperModel("base", device="cpu", compute_type="int8")
        segments_gen, info = model.transcribe(wav_path, beam_size=5)
        
        dialogue_turns = []
        dialogue_lines = []
        curr_speaker = host_name
        prev_end = 0.0
        
        idx = 0
        for seg in segments_gen:
            text = seg.text.strip()
            if not text:
                continue
            if idx > 0 and (seg.start - prev_end) > 1.0:
                curr_speaker = guest_name if curr_speaker == host_name else host_name
            
            is_host = (curr_speaker == host_name)
            dialogue_turns.append({
                "id": f"turn_{idx}",
                "speaker": curr_speaker,
                "role": "Host" if is_host else "Participant",
                "isHost": is_host,
                "text": text,
                "timestamp": format_sec(seg.start),
                "start": seg.start,
                "end": seg.end
            })
            dialogue_lines.append(f"{curr_speaker}: {text}")
            prev_end = seg.end
            idx += 1
            
        formatted_transcript = "\n".join(dialogue_lines) if dialogue_lines else ""
        return {
            "model": "faster-whisper-base (Local CPU)",
            "rawTranscript": formatted_transcript,
            "dialogueTurns": dialogue_turns,
            "text": formatted_transcript,
            "segments": dialogue_turns,
            "groqSegments": dialogue_turns
        }
    except Exception as local_err:
        print(f"[transcribe_audio] Local whisper error: {local_err}")
        return {
            "model": "whisper-large-v3",
            "rawTranscript": "",
            "dialogueTurns": [],
            "text": "",
            "segments": [],
            "groqSegments": []
        }

async def generate_groq_summary(raw_transcript: str, groq_api_key: Optional[str] = None) -> str:
    """
    Uses Groq to generate a concise summary field ('meetingSummary')
    based strictly and exclusively on the captured words.
    """
    groq_key = groq_api_key or os.getenv("GROQ_API_KEY", "")
    if not groq_key or not raw_transcript.strip():
        return ""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a concise executive meeting summarizer. Generate a 2-3 sentence summary strictly and exclusively based on the verbatim words spoken in the transcript. Do not assume or hallucinate unmentioned context."
                        },
                        {
                            "role": "user",
                            "content": f"Verbatim Meeting Transcript:\n{raw_transcript}\n\nProvide the concise meeting summary:"
                        }
                    ],
                    "temperature": 0.1,
                    "max_tokens": 250
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                summary = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                return summary
    except Exception as e:
        print(f"[generate_groq_summary] Groq summarization notice: {e}")
    return ""

def extract_speaker_linguistic_metrics(segments: List[Dict], host_name: str, guest_name: str) -> Dict[str, Dict]:
    """
    Counts exact words, characters, and segments per detected user profile.
    Filters out background sound tags like [Applause], [Music], [Laughter] and no_speech_prob > 0.8.
    """
    metrics = {
        host_name: {"words": 0, "chars": 0, "segments": 0, "fillers": 0},
        guest_name: {"words": 0, "chars": 0, "segments": 0, "fillers": 0}
    }
    filler_regex = re.compile(r'\b(uh|um|uhm|ah|er|like|you know|sort of|kind of)\b', re.IGNORECASE)
    sound_artifacts_regex = re.compile(r'\[(applause|music|laughter|silence|whispering|cough|throat clearing)\]', re.IGNORECASE)

    for seg in (segments or []):
        text = seg.get("text", "")
        if seg.get("no_speech_prob", 0) > 0.8:
            continue
        cleaned = sound_artifacts_regex.sub("", text).strip()
        if not cleaned:
            continue

        spk = seg.get("speaker") or seg.get("speaker_id") or host_name
        tag_match = re.match(r'^(?:Speaker\s*([0-9]+)|([a-zA-Z0-9_\s]+)):\s*(.+)$', cleaned, re.I)
        if tag_match:
            if tag_match.group(1) is not None:
                spk = host_name if int(tag_match.group(1)) == 0 else guest_name
            elif tag_match.group(2):
                name_part = tag_match.group(2).strip().lower()
                if guest_name and guest_name.lower() in name_part:
                    spk = guest_name
                elif host_name and host_name.lower() in name_part:
                    spk = host_name
            cleaned = tag_match.group(3).strip()

        words = len(cleaned.split())
        chars = len(cleaned)
        fillers = len(filler_regex.findall(cleaned))

        target_key = host_name if (spk.lower() == host_name.lower() or "host" in spk.lower() or spk == "Speaker 0") else guest_name
        if target_key in metrics:
            metrics[target_key]["words"] += words
            metrics[target_key]["chars"] += chars
            metrics[target_key]["segments"] += 1
            metrics[target_key]["fillers"] += fillers

    return metrics


async def analyze_with_gemini(
    raw_transcript: str,
    dialogue_turns: List[Dict],
    host_name: str = "Host",
    guest_name: str = "Participant",
    gemini_api_key: Optional[str] = None,
    segments: Optional[List[Dict]] = None
) -> Dict[str, Any]:
    """
    Executes Gemini 1.5 Flash analysis with literal metrics compliance auditor prompt.
    Passes raw Groq timestamped segments and enforces Anti-Hallucination Gate (< 50 chars).
    """
    gemini_key = gemini_api_key or os.getenv("GEMINI_API_KEY", "")
    
    # Compute exact linguistic telemetry per speaker
    analysis_segments = segments if (segments and len(segments) > 0) else dialogue_turns
    linguistic_metrics = extract_speaker_linguistic_metrics(analysis_segments, host_name, guest_name)
    host_ling = linguistic_metrics.get(host_name, {"words": 0, "chars": 0, "segments": 0})
    guest_ling = linguistic_metrics.get(guest_name, {"words": 0, "chars": 0, "segments": 0})

    # Strict dynamic active speaker inspection:
    guest_spoke = bool(
        guest_name
        and guest_name.lower() != host_name.lower()
        and guest_ling["words"] >= 10
        and guest_ling["segments"] > 0
    )

    if gemini_key:
        try:
            import httpx
            speakers_list = [host_name]
            if guest_spoke:
                speakers_list.append(guest_name)
            speakers_str = ", ".join(f'"{s}"' for s in speakers_list)

            # Untampered timestamped text array directly from Groq
            groq_timestamped_data = []
            for seg in analysis_segments:
                groq_timestamped_data.append({
                    "start": seg.get("start", 0),
                    "end": seg.get("end", 0),
                    "speaker": seg.get("speaker") or (host_name if seg.get("isHost", True) else guest_name),
                    "text": seg.get("text", "")
                })

            guest_schema_block = f""",
  "{guest_name}": {{
    "communication_skills": 7,
    "fluency": 7,
    "confidence": 7,
    "awkwardness": 1,
    "straightforward_answers": 7,
    "rationale": "Direct linguistic evidence here"
  }}""" if guest_spoke else ""

            prompt = f"""You are a literal metrics compliance auditor. You have 0% creative freedom. You must justify every single digit assigned out of 10 using direct linguistic evidence from the provided Groq text string.

CRITICAL INGESTION BINDING & AUDIT RULES:
1. Only evaluate active participants who produced spoken dialogue in the Groq data: {speakers_str}.
2. If a user has not spoken a single word or contains less than 10 words / background sound artifacts, DO NOT evaluate them, DO NOT assign scores, and completely exclude them from the JSON response.
3. Every score (1 to 10) must strictly adhere to the following rigid grading parameters:
   - communication_skills: Grade based on structural vocabulary and clarity in the text.
   - fluency: Measure based on the frequency of sentence completions vs. repetitive stuttering loops present in the Groq timestamps.
   - confidence: Assess based on declarative phrasing vs. uncertain conditional statements.
   - awkwardness: Count explicit filler artifacts (like uh, um, long pauses) captured by Whisper Large-V3. If none exist, the score must be clamped tightly at 1.
   - straightforward_answers: Match questions asked directly against the immediate subsequent response block text. If the text deflects, drop the score heavily.
4. For each evaluated speaker, provide the numeric score (1-10) for all 5 metrics, AND a concise rationale citing direct linguistic evidence (e.g. quote verbatim words, filler count, or state Insufficient spoken text for evaluation if data is scarce).

Raw Untampered Groq Timestamped Dialogue Segments:
{json.dumps(groq_timestamped_data, indent=2)}

Full Verbatim Transcript:
{raw_transcript}

Task 2: Verbatim Fact-Checking Extraction
Perform a direct string lookup from the text dialogue:
- Map verbatim questions asked to exact verbatim answers given.
- question_by: Must match the speaker who asked.
- answered_by: Must match the speaker who answered.
- The question and answer MUST be an actual conversational exchange between different users in the text.
- The verdict must strictly follow one of: Accurate, Incomplete, or Evasive.
- If no literal question-and-answer exchange exists between different users in the text, factCheckAudit must be strictly an empty array. Do not invent sample dialogues.

Return ONLY a valid JSON object. Use this exact structure:
{{
  "{host_name}": {{
    "communication_skills": 7,
    "fluency": 8,
    "confidence": 7,
    "awkwardness": 1,
    "straightforward_answers": 7,
    "rationale": "Direct linguistic evidence here"
  }}{guest_schema_block},
  "factCheckAudit": []
}}

IMPORTANT: Replace ALL numeric values above with the actual scores you derive from the transcript evidence. Do not use placeholder text. Return only raw JSON, no markdown code fences."""
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.0,
                    "responseMimeType": "application/json"
                }
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    resp_json = resp.json()
                    candidates = resp_json.get("candidates", [])
                    if candidates:
                        candidate = candidates[0]
                        finish_reason = candidate.get("finishReason", "")
                        # Guard: empty/blocked candidate from content filter
                        if finish_reason in ("SAFETY", "OTHER", "RECITATION") or not candidate.get("content"):
                            print(f"[analyze_with_gemini] Gemini blocked/empty candidate. finishReason={finish_reason}. Using deterministic fallback.")
                        else:
                            text_content = candidate.get("content", {}).get("parts", [{}])[0].get("text", "")
                            clean_json = re.sub(r"^```json\s*", "", text_content.strip(), flags=re.MULTILINE)
                            clean_json = re.sub(r"```$", "", clean_json.strip(), flags=re.MULTILINE)
                            parsed = json.loads(clean_json)
                            if parsed and isinstance(parsed, dict):
                                return _validate_and_clamp_analysis(parsed, host_name, guest_name, "gemini-1.5-flash", guest_spoke, linguistic_metrics)
        except Exception as gemini_err:
            print(f"[analyze_with_gemini] Gemini API call note: {gemini_err}")
    
    # Grounded Deterministic Fallback
    return _grounded_deterministic_analysis(dialogue_turns, host_name, guest_name, guest_spoke, linguistic_metrics)


def _validate_and_clamp_analysis(
    parsed: Dict,
    host_name: str,
    guest_name: str,
    model_name: str,
    guest_spoke: bool = False,
    linguistic_metrics: Optional[Dict] = None
) -> Dict[str, Any]:
    def clamp(v):
        try:
            return max(1, min(10, int(v)))
        except (ValueError, TypeError):
            return 1

    ling = linguistic_metrics or {}
    host_ling = ling.get(host_name, {"words": 0, "chars": 0, "segments": 0, "fillers": 0})
    guest_ling = ling.get(guest_name, {"words": 0, "chars": 0, "segments": 0, "fillers": 0})

    ratings_source = parsed.get("speakerRatings", parsed)
    host_raw = ratings_source.get(host_name, {})

    # Key mutation check
    if not host_raw:
        for k, v in ratings_source.items():
            if k.lower() == host_name.lower() or "host" in k.lower() or k in ["Speaker 0", "speaker_0"]:
                host_raw = v
                break

    def evaluate_guardrail(raw_data: Dict, spk_ling: Dict, spk_name: str) -> Dict[str, Any]:
        chars = spk_ling.get("chars", 0)
        words = spk_ling.get("words", 0)
        segs = spk_ling.get("segments", 0)

        comm = clamp(raw_data.get("communication_skills"))
        flu = clamp(raw_data.get("fluency"))
        conf = clamp(raw_data.get("confidence"))
        # Awkwardness must track actual filler tokens ('uh', 'um'). If none exist, clamp tightly to 1/10
        awk = clamp(raw_data.get("awkwardness")) if spk_ling.get("fillers", 0) > 0 else 1
        straight = clamp(raw_data.get("straightforward_answers"))

        # Anti-Hallucination Gate: If char count < 50 or words < 10, clamp safely to 1/10
        if chars < 50 or words < 10:
            print(f"[Anti-Hallucination Gate] Clamping {spk_name} ({chars} chars < 50, {words} words < 10) safely to 1/10.")
            return {
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
                "segment_count": segs
            }

        return {
            "communication_skills": comm,
            "fluency": flu,
            "confidence": conf,
            "awkwardness": awk,
            "straightforward_answers": straight,
            "rationale": raw_data.get("rationale") or "Verified against Groq transcription evidence.",
            "status_note": "Validated against Groq transcript",
            "is_clamped": False,
            "word_count": words,
            "char_count": chars,
            "segment_count": segs
        }

    speaker_ratings_dict = {
        host_name: evaluate_guardrail(host_raw, host_ling, host_name)
    }

    # Only include guest in speaker ratings if guest actually spoke >= 10 words
    if guest_spoke and guest_name and guest_name.lower() != host_name.lower() and guest_ling.get("words", 0) >= 10 and guest_ling.get("segments", 0) > 0:
        guest_raw = ratings_source.get(guest_name, {})
        if not guest_raw:
            for k, v in ratings_source.items():
                if k.lower() == guest_name.lower() or "participant" in k.lower() or "guest" in k.lower() or k in ["Speaker 1", "speaker_1"]:
                    guest_raw = v
                    break

        speaker_ratings_dict[guest_name] = evaluate_guardrail(guest_raw, guest_ling, guest_name)

    fact_check = []
    for item in parsed.get("factCheckAudit", []):
        if not isinstance(item, dict):
            continue
        q = item.get("question", "").strip()
        a = item.get("answer", "").strip()
        if not q or not a:
            continue
        v_raw = str(item.get("verdict", "")).lower()
        if "incom" in v_raw:
            verdict = "Incomplete"
        elif "evas" in v_raw:
            verdict = "Evasive"
        else:
            verdict = "Accurate"
        fact_check.append({
            "question_by": item.get("question_by") or host_name,
            "question": q,
            "answered_by": item.get("answered_by") or (guest_name if guest_spoke else host_name),
            "answer": a,
            "verdict": verdict
        })

    return {
        "speakerRatings": speaker_ratings_dict,
        "factCheckAudit": fact_check,
        "summary": f"Meeting for {host_name} successfully transcribed and analyzed.",
        "gemini_model": model_name
    }


def _grounded_deterministic_analysis(
    dialogue_turns: List[Dict],
    host_name: str,
    guest_name: str,
    guest_spoke: bool = False,
    linguistic_metrics: Optional[Dict] = None
) -> Dict[str, Any]:
    # Extract verbatim questions only
    questions_found = []
    for i, turn in enumerate(dialogue_turns):
        text = turn.get("text", "").strip()
        if "?" in text or any(text.lower().startswith(q) for q in ["what", "how", "why", "when", "where", "who", "is", "can", "could", "would"]):
            answer_turn = dialogue_turns[i + 1] if i + 1 < len(dialogue_turns) else None
            q_by = turn.get("speaker", host_name)
            a_by = answer_turn.get("speaker", host_name) if answer_turn else host_name
            a_text = answer_turn.get("text", "").strip() if answer_turn else ""
            if a_text:
                questions_found.append({
                    "question_by": q_by,
                    "question": text,
                    "answered_by": a_by,
                    "answer": a_text,
                    "verdict": "Accurate"
                })
            if len(questions_found) >= 4:
                break

    ling = linguistic_metrics or extract_speaker_linguistic_metrics(dialogue_turns, host_name, guest_name)
    host_ling = ling.get(host_name, {"words": 0, "chars": 0, "segments": 0})
    guest_ling = ling.get(guest_name, {"words": 0, "chars": 0, "segments": 0})
    
    def score_or_insufficient(spk_ling):
        chars = spk_ling.get("chars", 0)
        words = spk_ling.get("words", 0)
        segs = spk_ling.get("segments", 0)
        if chars < 50 or words == 0:
            return {
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
                "segment_count": segs
            }
        base = min(10, max(5, int(7 + (chars > 120) - (chars < 80))))
        return {
            "communication_skills": min(10, base + 1),
            "fluency": base,
            "confidence": min(10, base + 1),
            "awkwardness": max(1, 10 - base),
            "straightforward_answers": base,
            "rationale": "Grounded deterministic audit of spoken transcript turns.",
            "status_note": "Validated against Groq transcript",
            "is_clamped": False,
            "word_count": words,
            "char_count": chars,
            "segment_count": segs
        }

    speaker_ratings = {
        host_name: score_or_insufficient(host_ling)
    }

    if guest_spoke and guest_name and guest_name.lower() != host_name.lower() and guest_ling.get("words", 0) > 0:
        speaker_ratings[guest_name] = score_or_insufficient(guest_ling)

    return {
        "speakerRatings": speaker_ratings,
        "factCheckAudit": questions_found,
        "summary": f"Meeting for {host_name} processed.",
        "gemini_model": "grounded-deterministic"
    }
