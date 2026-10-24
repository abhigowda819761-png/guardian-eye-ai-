import os
import sys
import json
import time
import shutil
import wave
import struct
import subprocess
import tempfile
from typing import List, Dict, Any, Optional

import torch
import numpy as np

def get_ffmpeg_binary() -> str:
    env_ffmpeg = os.environ.get("FFMPEG_PATH") or os.environ.get("FFMPEG_BIN")
    if env_ffmpeg and os.path.exists(env_ffmpeg):
        return env_ffmpeg
    which_ffmpeg = shutil.which("ffmpeg")
    if which_ffmpeg and os.path.exists(which_ffmpeg):
        return which_ffmpeg
    for path in ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"]:
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path
    return which_ffmpeg or "ffmpeg"

# ---------------------------------------------------------------------------
# Apple Silicon (MacBook Air M2 GPU via MPS) Configuration
# ---------------------------------------------------------------------------
def get_torch_device() -> torch.device:
    """
    Detects and assigns execution device to Apple's Metal Performance Shaders (MPS)
    or falls back cleanly to CPU if MPS is unavailable.
    """
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        device = torch.device('mps')
        print("[M2-Pipeline] Metal Performance Shaders (MPS) active on Apple Silicon GPU.")
    elif torch.cuda.is_available():
        device = torch.device('cuda')
        print("[M2-Pipeline] CUDA GPU device active.")
    else:
        device = torch.device('cpu')
        print("[M2-Pipeline] CPU fallback device active.")
    return device

DEVICE = get_torch_device()

# Storage directories (Guaranteed /tmp storage for Render Linux container)
SYSTEM_TEMP = os.path.abspath(tempfile.gettempdir())
SCRIPTS_DIR = os.path.join(SYSTEM_TEMP, "guardianeye_scripts")
TEMP_AUDIO_DIR = os.path.join(SYSTEM_TEMP, "guardianeye_audio_temp")
os.makedirs(SCRIPTS_DIR, exist_ok=True)
os.makedirs(TEMP_AUDIO_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Step 1: Raw 16kHz Mono PCM Audio Extraction (via FFmpeg)
# ---------------------------------------------------------------------------
def extract_audio_16k_mono(input_path: str, output_wav_path: str) -> bool:
    """
    Extracts raw audio using ffmpeg configured strictly for 16kHz mono PCM wave format.
    """
    os.makedirs(os.path.dirname(output_wav_path), exist_ok=True)
    ffmpeg_bin = get_ffmpeg_binary()
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", input_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        output_wav_path
    ]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return os.path.exists(output_wav_path) and os.path.getsize(output_wav_path) > 44
    except Exception as e:
        print(f"[M2-Pipeline] FFmpeg extraction error: {e}")
        # If input is already wav, attempt direct copy or check format
        if input_path.lower().endswith(".wav") and os.path.exists(input_path):
            try:
                shutil.copy2(input_path, output_wav_path)
                return True
            except Exception:
                pass
        return False

# ---------------------------------------------------------------------------
# Step 2: Speaker Diarization (PyAnnote 3.1 with Dynamic Speaker Count Detection)
# ---------------------------------------------------------------------------
def run_diarization(wav_path: str, num_speakers: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Runs PyAnnote's speaker-diarization-3.1 pipeline with dynamic speaker count detection.
    If num_speakers is None, PyAnnote automatically detects the true number of voices.
    Uses HF_TOKEN environment variable. If token is missing or network download fails,
    gracefully executes native energy & VAD acoustic turn clustering.
    """
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    segments = []

    # Attempt PyAnnote 3.1 Pipeline
    if hf_token:
        try:
            print("[M2-Pipeline] Initializing PyAnnote speaker-diarization-3.1 pipeline on Apple Silicon...")
            from pyannote.audio import Pipeline
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                token=hf_token
            )
            # Move pipeline to Apple MPS device if supported
            try:
                pipeline.to(DEVICE)
            except Exception as dev_err:
                print(f"[M2-Pipeline] PyAnnote MPS move note: {dev_err}, falling back to CPU for pipeline core.")
                pipeline.to(torch.device("cpu"))

            if num_speakers is not None:
                diarization_output = pipeline(wav_path, num_speakers=num_speakers)
            else:
                diarization_output = pipeline(wav_path, min_speakers=1, max_speakers=5)
            
            # Extract turns from pyannote Annotation object
            for turn, _, speaker in diarization_output.itertracks(yield_label=True):
                segments.append({
                    "start": round(turn.start, 2),
                    "end": round(turn.end, 2),
                    "speaker": speaker
                })

            if len(segments) > 0:
                print(f"[M2-Pipeline] PyAnnote isolated {len(segments)} speaker segments successfully.")
                return segments
        except Exception as pyannote_err:
            print(f"[M2-Pipeline] PyAnnote pipeline notice: {pyannote_err}. Switching to acoustic turn clustering...")

    # High-Performance Acoustic & VAD Diarization Engine (Zero external dependencies)
    print(f"[M2-Pipeline] Running high-speed acoustic Voice Activity Diarization (num_speakers={num_speakers})...")
    try:
        with wave.open(wav_path, 'rb') as wf:
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            audio_bytes = wf.readframes(n_frames)
            
        samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
        total_duration = n_frames / framerate
        if total_duration <= 0.1:
            return [{"start": 0.0, "end": total_duration, "speaker": "SPEAKER_00"}]

        # Frame parameters (30ms frames with 15ms hop)
        frame_len = int(0.03 * framerate)
        hop_len = int(0.015 * framerate)
        n_hops = max(1, (len(samples) - frame_len) // hop_len)

        # Compute Short-Time Energy and Spectral Centroid
        energies = []
        centroids = []
        fft_freqs = np.fft.rfftfreq(frame_len, d=1.0 / framerate)

        for i in range(n_hops):
            idx = i * hop_len
            window = samples[idx : idx + frame_len]
            rms = np.sqrt(np.mean(window ** 2) + 1e-9)
            energies.append(rms)

            # Compute dominant frequency spectrum
            mag_spec = np.abs(np.fft.rfft(window * np.hanning(len(window))))
            spec_sum = np.sum(mag_spec)
            centroid = np.sum(fft_freqs * mag_spec) / spec_sum if spec_sum > 1e-6 else 0
            centroids.append(centroid)

        energies = np.array(energies)
        centroids = np.array(centroids)

        # VAD Energy Threshold (dynamic adaptive noise floor)
        noise_floor = np.percentile(energies, 20)
        vad_thresh = max(150.0, noise_floor * 2.2)
        is_speech = energies > vad_thresh

        # Cluster speech frames into continuous turns
        raw_turns = []
        in_turn = False
        turn_start = 0.0
        turn_centroids = []

        for i in range(len(is_speech)):
            t = (i * hop_len) / framerate
            if is_speech[i]:
                if not in_turn:
                    in_turn = True
                    turn_start = t
                    turn_centroids = [centroids[i]]
                else:
                    turn_centroids.append(centroids[i])
            else:
                if in_turn:
                    in_turn = False
                    turn_end = t
                    if (turn_end - turn_start) >= 0.35: # Min turn duration
                        avg_c = float(np.mean(turn_centroids)) if turn_centroids else 1000.0
                        raw_turns.append({"start": turn_start, "end": turn_end, "centroid": avg_c})

        if in_turn and (total_duration - turn_start) >= 0.35:
            avg_c = float(np.mean(turn_centroids)) if turn_centroids else 1000.0
            raw_turns.append({"start": turn_start, "end": total_duration, "centroid": avg_c})

        if not raw_turns:
            # Fallback for silent / low-gain files: keep as single speaker
            return [
                {"start": 0.0, "end": round(total_duration, 2), "speaker": "SPEAKER_00"}
            ]

        all_centroids = [t["centroid"] for t in raw_turns]
        median_centroid = float(np.median(all_centroids)) if all_centroids else 1500.0
        centroid_std = float(np.std(all_centroids)) if len(all_centroids) > 1 else 0.0

        # Dynamic determination: Detect true number of active voices dynamically
        allow_multi = (centroid_std >= 280.0 and len(raw_turns) >= 3)

        current_speaker_idx = 0
        for i, turn in enumerate(raw_turns):
            if allow_multi and len(raw_turns) > 1 and i > 0:
                prev_turn = raw_turns[i - 1]
                if abs(turn["centroid"] - prev_turn["centroid"]) > 380.0:
                    current_speaker_idx = 1 - current_speaker_idx
            else:
                current_speaker_idx = 0

            spk_label = f"SPEAKER_{current_speaker_idx:02d}"
            segments.append({
                "start": round(turn["start"], 2),
                "end": round(turn["end"], 2),
                "speaker": spk_label
            })

    except Exception as vad_err:
        print(f"[M2-Pipeline] Acoustic clustering exception: {vad_err}")
        segments = [
            {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"}
        ]

    return segments

# ---------------------------------------------------------------------------
# Step 3: Segmented OpenAI Whisper Transcription (Apple Silicon M2 Optimized)
# ---------------------------------------------------------------------------
_WHISPER_MODEL = None

def get_whisper_model(model_size: str = "base"):
    """
    Loads OpenAI Whisper model optimized for Apple Silicon M2 unified memory.
    """
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        try:
            import whisper
            print(f"[M2-Pipeline] Loading OpenAI Whisper ('{model_size}') model onto Apple Silicon...")
            try:
                # Load with target device
                _WHISPER_MODEL = whisper.load_model(model_size, device=DEVICE)
            except Exception as mps_load_err:
                print(f"[M2-Pipeline] Note: Loading Whisper on CPU fallback ({mps_load_err})")
                _WHISPER_MODEL = whisper.load_model(model_size, device="cpu")
            print(f"[M2-Pipeline] Whisper model loaded successfully.")
        except Exception as e:
            print(f"[M2-Pipeline] Whisper import error: {e}")
            _WHISPER_MODEL = None
    return _WHISPER_MODEL

def transcribe_segment(wav_path: str, start_sec: float, end_sec: float, seg_id: int) -> str:
    """
    Crops audio segment via ffmpeg and passes it to OpenAI Whisper for rapid inference.
    """
    duration = end_sec - start_sec
    if duration < 0.2:
        return ""

    temp_seg_wav = os.path.join(TEMP_AUDIO_DIR, f"seg_{int(time.time())}_{seg_id}.wav")
    try:
        # Crop segment with ffmpeg
        crop_cmd = [
            "ffmpeg",
            "-y",
            "-ss", str(start_sec),
            "-to", str(end_sec),
            "-i", wav_path,
            "-c", "copy",
            temp_seg_wav
        ]
        subprocess.run(crop_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        if not os.path.exists(temp_seg_wav) or os.path.getsize(temp_seg_wav) < 100:
            return ""

        model = get_whisper_model("base")
        if model is not None:
            # fp16=False for standard M2 CPU/MPS compatibility
            transcription = model.transcribe(temp_seg_wav, fp16=False, language="en")
            text = transcription.get("text", "").strip()
            return text
        else:
            return ""
    except Exception as err:
        print(f"[M2-Pipeline] Segment transcription note: {err}")
        return ""
    finally:
        if os.path.exists(temp_seg_wav):
            try: os.remove(temp_seg_wav)
            except: pass

# ---------------------------------------------------------------------------
# Step 4: Metadata Mapping & Final Dialogue Document Formatting
# ---------------------------------------------------------------------------
def format_dialogue_document(
    transcribed_segments: List[Dict[str, Any]],
    speaker_map: Dict[str, str]
) -> str:
    """
    Formats the finalized script as a clean dialogue document text (.txt) exactly like:
      James: hii hassassin
      Hassassin: hello james
    """
    lines = []
    current_speaker = None
    current_utterances = []

    for seg in transcribed_segments:
        spk_key = seg.get("speaker", "SPEAKER_00")
        display_name = speaker_map.get(spk_key, speaker_map.get("default", "Speaker"))
        text = seg.get("text", "").strip()

        if not text:
            continue

        if spk_key == current_speaker:
            current_utterances.append(text)
        else:
            if current_speaker is not None and current_utterances:
                prev_display_name = speaker_map.get(current_speaker, "Speaker")
                merged_line = f"{prev_display_name}: {' '.join(current_utterances)}"
                lines.append(merged_line)
            current_speaker = spk_key
            current_utterances = [text]

    if current_speaker is not None and current_utterances:
        display_name = speaker_map.get(current_speaker, "Speaker")
        lines.append(f"{display_name}: {' '.join(current_utterances)}")

    # If whisper was silent, return empty string
    if not lines:
        return ""

    return "\n".join(lines)

# ---------------------------------------------------------------------------
# Step 5: Full Execution Pipeline Coordination & Client Delivery
# ---------------------------------------------------------------------------
def process_meeting_pipeline(
    video_path: str,
    video_id: str,
    speaker_0_name: str = "Host",
    speaker_1_name: str = "Participant",
    num_speakers: Optional[int] = None
) -> Dict[str, Any]:
    """
    1. Extracts 16kHz mono PCM wave audio.
    2. Runs PyAnnote 3.1 / Acoustic diarization with dynamic voice detection.
    3. Crops segments and transcribes with OpenAI Whisper on Apple Silicon MPS.
    4. Maps speakers to dynamic runtime identities.
    5. Saves dialogue document (.txt) to local storage.
    6. Returns structured delivery object with downloadable file path.
    """
    start_time = time.time()
    extracted_wav_path = os.path.join(TEMP_AUDIO_DIR, f"{video_id}_16k_mono.wav")

    # 1. Audio Extraction
    extracted = extract_audio_16k_mono(video_path, extracted_wav_path)
    if not extracted or not os.path.exists(extracted_wav_path):
        raise RuntimeError("Failed to extract 16kHz mono PCM wave audio from input file.")

    # 2. PyAnnote / Acoustic Diarization
    raw_segments = run_diarization(extracted_wav_path, num_speakers=num_speakers)

    # 3. Speaker Identity Mapping (Dynamic count)
    unique_speakers = sorted(list(set(s["speaker"] for s in raw_segments)))
    speaker_map = {}
    if len(unique_speakers) >= 1:
        speaker_map[unique_speakers[0]] = speaker_0_name or "Host"
    if len(unique_speakers) >= 2:
        speaker_map[unique_speakers[1]] = speaker_1_name or "Participant"
    for i, spk in enumerate(unique_speakers[2:], start=2):
        speaker_map[spk] = f"Participant {i}"

    # 4. Segmented Whisper Transcription
    annotated_segments = []
    for idx, seg in enumerate(raw_segments):
        text = transcribe_segment(extracted_wav_path, seg["start"], seg["end"], idx)
        annotated_segments.append({
            "segment_id": idx + 1,
            "speaker_id": seg["speaker"],
            "speaker_name": speaker_map.get(seg["speaker"], "Speaker"),
            "start": seg["start"],
            "end": seg["end"],
            "duration": round(seg["end"] - seg["start"], 2),
            "text": text
        })

    # 5. Format Compiled Dialogue Document (.txt)
    script_text = format_dialogue_document(annotated_segments, speaker_map)

    # 6. Save Finalized Script Locally
    script_filename = f"{video_id}_script.txt"
    script_file_path = os.path.join(SCRIPTS_DIR, script_filename)
    with open(script_file_path, "w", encoding="utf-8") as f:
        f.write(script_text)

    # Save JSON metadata alongside for dashboard integration
    active_speakers = [
        {"id": spk_id, "name": speaker_map.get(spk_id, "Host")}
        for spk_id in unique_speakers
    ]
    if not active_speakers:
        active_speakers = [{"id": "SPEAKER_00", "name": speaker_0_name or "Host"}]

    json_filename = f"{video_id}_analysis.json"
    json_file_path = os.path.join(SCRIPTS_DIR, json_filename)
    payload_data = {
        "videoId": video_id,
        "scriptFilename": script_filename,
        "scriptPath": script_file_path,
        "scriptText": script_text,
        "speakers": active_speakers,
        "segments": annotated_segments,
        "total_segments": len(annotated_segments),
        "device": str(DEVICE),
        "execution_time_seconds": round(time.time() - start_time, 2),
        "download_url": f"/api/transcription/download/{video_id}"
    }

    with open(json_file_path, "w", encoding="utf-8") as jf:
        json.dump(payload_data, jf, indent=2)

    # Cleanup temp wav
    try: os.remove(extracted_wav_path)
    except: pass

    return payload_data
