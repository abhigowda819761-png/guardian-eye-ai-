import os
import subprocess
import shutil
import wave
import time
import math
import numpy as np
from scipy.signal import find_peaks
from typing import Dict, List, Any, Tuple
from speech_analytics import analyze_speaker_acoustics, generate_meeting_insights

# Locate FFmpeg binary
FFMPEG_BIN = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
if not os.path.exists(FFMPEG_BIN) and shutil.which("ffmpeg"):
    FFMPEG_BIN = shutil.which("ffmpeg")

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
AUDIO_OUTPUT_DIR = os.path.join(UPLOAD_DIR, "audio")
os.makedirs(AUDIO_OUTPUT_DIR, exist_ok=True)

def format_timestamp(seconds: float) -> str:
    """Format seconds into MM:SS format."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"

def extract_master_wav_from_video(video_path: str, output_wav_path: str) -> bool:
    """
    Extracts a 16kHz, 16-bit mono PCM WAV audio track from the video file using FFmpeg.
    This format is optimal for spectral analysis and speech processing.
    """
    if not os.path.exists(FFMPEG_BIN):
        raise RuntimeError(f"FFmpeg binary not found at {FFMPEG_BIN}")

    cmd = [
        FFMPEG_BIN,
        "-y",               # Overwrite output
        "-i", video_path,   # Input video
        "-vn",              # Disable video recording
        "-acodec", "pcm_s16le", # Uncompressed 16-bit PCM
        "-ar", "16000",     # 16,000 Hz sample rate
        "-ac", "1",         # Mono audio
        output_wav_path
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        error_msg = result.stderr.decode('utf-8', errors='ignore')
        if "does not contain any stream" in error_msg or "matches no streams" in error_msg:
            # Create a 3-second empty wav if video has no audio
            with wave.open(output_wav_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(16000)
                wf.writeframes(b"\x00" * 32000 * 3)
        else:
            raise RuntimeError(f"FFmpeg audio extraction failed: {error_msg}")
    
    return os.path.exists(output_wav_path)

def load_wav_samples(wav_path: str) -> Tuple[np.ndarray, int]:
    """Reads uncompressed WAV file into normalized float32 numpy array and sample rate."""
    with wave.open(wav_path, "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        raw_bytes = wf.readframes(n_frames)

    if sampwidth == 2:
        samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        samples = np.frombuffer(raw_bytes, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        samples = np.frombuffer(raw_bytes, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0

    return samples, framerate

def detect_speech_segments(
    samples: np.ndarray,
    sr: int,
    frame_duration: float = 0.05,
    energy_threshold_percentile: float = 25.0,
    min_speech_duration: float = 0.8,
    min_silence_duration: float = 0.6
) -> List[Tuple[float, float]]:
    """
    Voice Activity Detection (VAD) via short-time root-mean-square energy (RMS).
    Identifies clean speech bursts and filters out background silence.
    """
    frame_size = int(sr * frame_duration)
    hop_size = frame_size // 2
    n_frames = (len(samples) - frame_size) // hop_size

    if n_frames <= 0:
        total_sec = len(samples) / sr
        return [(0.0, total_sec)] if total_sec > 0.5 else []

    # Calculate frame energies
    energies = np.zeros(n_frames)
    for i in range(n_frames):
        start_idx = i * hop_size
        frame = samples[start_idx : start_idx + frame_size]
        energies[i] = np.sqrt(np.mean(frame**2) + 1e-12)

    # Adaptive threshold
    mean_energy = np.mean(energies)
    noise_floor = np.percentile(energies, energy_threshold_percentile)
    threshold = noise_floor + 0.15 * (mean_energy - noise_floor)
    threshold = max(threshold, 0.012) # Floor guard

    # Speech vs silence mask
    is_speech = energies > threshold

    # Group into continuous intervals
    segments: List[Tuple[float, float]] = []
    in_speech = False
    speech_start_sec = 0.0
    silence_count = 0
    silence_frames_threshold = int(min_silence_duration / (hop_size / sr))

    for i, active in enumerate(is_speech):
        time_sec = (i * hop_size) / sr
        if active:
            if not in_speech:
                in_speech = True
                speech_start_sec = time_sec
            silence_count = 0
        else:
            if in_speech:
                silence_count += 1
                if silence_count >= silence_frames_threshold:
                    speech_end_sec = (i - silence_count) * hop_size / sr
                    if (speech_end_sec - speech_start_sec) >= min_speech_duration:
                        segments.append((round(speech_start_sec, 2), round(speech_end_sec, 2)))
                    in_speech = False
                    silence_count = 0

    if in_speech:
        speech_end_sec = len(samples) / sr
        if (speech_end_sec - speech_start_sec) >= min_speech_duration:
            segments.append((round(speech_start_sec, 2), round(speech_end_sec, 2)))

    # Fallback if no clean segments found
    if not segments and (len(samples) / sr) > 0.5:
        segments = [(0.0, round(len(samples) / sr, 2))]

    return segments

def extract_acoustic_embedding(samples: np.ndarray, sr: int, start_sec: float, end_sec: float) -> np.ndarray:
    """
    Extracts acoustic speaker voice fingerprint (F0 pitch, spectral centroid, spectral rolloff, bandwidth).
    This vector distinguishes individual speaker voices from one another.
    """
    s_idx = max(0, int(start_sec * sr))
    e_idx = min(len(samples), int(end_sec * sr))
    clip = samples[s_idx:e_idx]

    if len(clip) < sr * 0.2:
        return np.zeros(6, dtype=np.float32)

    # 1. Fundamental frequency (Pitch estimation via autocorrelation)
    corr = np.correlate(clip[: min(len(clip), sr * 2)], clip[: min(len(clip), sr * 2)], mode='full')
    corr = corr[len(corr)//2 :]
    # Search in human vocal range: 75 Hz to 450 Hz
    min_lag = int(sr / 450)
    max_lag = int(sr / 75)
    lag_range = corr[min_lag:max_lag]
    pitch = 180.0
    if len(lag_range) > 0 and np.max(lag_range) > 0:
        pitch = float(sr / (min_lag + np.argmax(lag_range)))

    # 2. FFT Spectral analysis with Hanning window to eliminate boundary transients
    fft_clip = clip[: min(len(clip), sr * 3)]
    window = np.hanning(len(fft_clip))
    fft_vals = np.abs(np.fft.rfft(fft_clip * window))
    freqs = np.fft.rfftfreq(len(fft_clip), 1.0 / sr)
    sum_fft = np.sum(fft_vals) + 1e-12

    # Spectral centroid (vocal brightness)
    centroid = float(np.sum(freqs * fft_vals) / sum_fft)

    # Spectral spread / bandwidth
    bandwidth = float(np.sqrt(np.sum(((freqs - centroid)**2) * fft_vals) / sum_fft))

    # Spectral rolloff (85% energy frequency)
    cumsum = np.cumsum(fft_vals)
    rolloff_idx = np.where(cumsum >= 0.85 * sum_fft)[0]
    rolloff = float(freqs[rolloff_idx[0]]) if len(rolloff_idx) > 0 else 3000.0

    # Zero crossing rate (articulation roughness)
    zcr = float(np.mean(np.abs(np.diff(np.sign(clip)))) / 2.0)

    # Dynamic RMS energy
    rms = float(np.sqrt(np.mean(clip**2)))

    return np.array([pitch, centroid, bandwidth, rolloff, zcr * 1000.0, rms * 100.0], dtype=np.float32)

def cluster_speakers(
    embeddings: List[np.ndarray],
    max_speakers: int = 5
) -> List[int]:
    """
    Groups speech segment embeddings into distinct speaker identities (Speaker 1, Speaker 2, etc.)
    Uses feature standardization and distance-based clustering.
    """
    n_samples = len(embeddings)
    if n_samples == 0:
        return []
    if n_samples == 1:
        return [0]

    X = np.array(embeddings)
    # Normalize features
    std = np.std(X, axis=0) + 1e-6
    mean = np.mean(X, axis=0)
    X_norm = (X - mean) / std

    # Weight pitch and spectral centroid higher for speaker separation
    weights = np.array([2.5, 2.0, 1.2, 1.0, 1.0, 0.8])
    X_norm = X_norm * weights

    # Determine optimal speaker count (1 to min(n_samples, max_speakers))
    cluster_centers = [X_norm[0]]
    labels = [0] * n_samples

    for i in range(1, n_samples):
        dists = [np.linalg.norm(X_norm[i] - center) for center in cluster_centers]
        min_dist = min(dists)
        closest_cluster = int(np.argmin(dists))

        # Distance threshold: if voice is distinct enough and we haven't reached max_speakers
        if min_dist > 3.0 and len(cluster_centers) < max_speakers:
            cluster_centers.append(X_norm[i])
            labels[i] = int(len(cluster_centers) - 1)
        else:
            labels[i] = closest_cluster
            # Move center slightly toward new sample
            cluster_centers[closest_cluster] = 0.85 * cluster_centers[closest_cluster] + 0.15 * X_norm[i]

    return labels

def slice_wav_segment(src_wav: str, dest_wav: str, start_sec: float, end_sec: float):
    """Extracts a precise time slice from an uncompressed WAV file."""
    with wave.open(src_wav, "rb") as r:
        framerate = r.getframerate()
        n_channels = r.getnchannels()
        sampwidth = r.getsampwidth()
        
        start_frame = int(start_sec * framerate)
        num_frames = int((end_sec - start_sec) * framerate)
        
        r.setpos(start_frame)
        frames = r.readframes(num_frames)

    with wave.open(dest_wav, "wb") as w:
        w.setnchannels(n_channels)
        w.setsampwidth(sampwidth)
        w.setframerate(framerate)
        w.writeframes(frames)

def create_speaker_consolidated_wav(src_wav: str, dest_wav: str, intervals: List[Tuple[float, float]]):
    """Combines all speech segments spoken by a specific speaker into a single continuous WAV."""
    if not intervals:
        return
    with wave.open(src_wav, "rb") as r:
        framerate = r.getframerate()
        n_channels = r.getnchannels()
        sampwidth = r.getsampwidth()
        total_frames = r.getnframes()
        
        combined_frames = bytearray()
        for start_sec, end_sec in intervals:
            start_f = min(total_frames, max(0, int(start_sec * framerate)))
            end_f = min(total_frames, max(0, int(end_sec * framerate)))
            if end_f > start_f:
                r.setpos(start_f)
                combined_frames.extend(r.readframes(end_f - start_f))

    if not combined_frames:
        combined_frames = bytearray(b"\x00" * 1600)

    with wave.open(dest_wav, "wb") as w:
        w.setnchannels(n_channels)
        w.setsampwidth(sampwidth)
        w.setframerate(framerate)
        w.writeframes(bytes(combined_frames))

def process_video_diarization(video_path: str, video_id: str) -> Dict[str, Any]:
    """
    Main Pipeline:
    1. Extracts master 16kHz WAV from video via FFmpeg.
    2. Runs Voice Activity Detection to find who spoke when.
    3. Extracts voice embeddings and clusters by speaker.
    4. Slices individual audio clips for every speaker turn.
    5. Combines per-speaker speech into consolidated speaker WAV files.
    6. Returns complete timeline with timestamps and audio stream URLs.
    """
    session_audio_dir = os.path.join(AUDIO_OUTPUT_DIR, video_id)
    os.makedirs(session_audio_dir, exist_ok=True)

    master_wav_path = os.path.join(session_audio_dir, "master_audio.wav")
    extract_master_wav_from_video(video_path, master_wav_path)

    samples, sr = load_wav_samples(master_wav_path)
    total_duration_sec = len(samples) / sr

    # Step 1: Detect speech intervals
    speech_segments = detect_speech_segments(samples, sr)
    if not speech_segments:
        total_sec = max(round(total_duration_sec, 2), 1.0)
        speech_segments = [(0.0, total_sec)]

    # Step 2: Extract acoustic voice embeddings
    embeddings = [
        extract_acoustic_embedding(samples, sr, start, end)
        for (start, end) in speech_segments
    ]

    # Step 3: Cluster into speaker labels (Speaker 0, 1, ...)
    speaker_labels = cluster_speakers(embeddings, max_speakers=5)
    if not speaker_labels:
        speaker_labels = [0] * len(speech_segments)

    # Friendly speaker names matching meeting roles
    default_names = ["Abhishek S. (Host)", "Priya Sharma", "Rahul Verma", "Ananya Patel", "Karan Singh"]

    # Step 4: Organize turns and slice audio files
    speakers_dict: Dict[int, dict] = {}
    chronological_timeline: List[dict] = []
    total_speech_time = 0.0

    for idx, ((start, end), spk_id) in enumerate(zip(speech_segments, speaker_labels)):
        duration = round(end - start, 2)
        total_speech_time += duration

        # Slice individual turn audio
        turn_filename = f"speaker_{spk_id + 1}_turn_{idx + 1}.wav"
        turn_path = os.path.join(session_audio_dir, turn_filename)
        slice_wav_segment(master_wav_path, turn_path, start, end)
        turn_url = f"/api/audio/stream/{video_id}/{turn_filename}"

        spk_name = default_names[spk_id % len(default_names)]

        turn_item = {
            "turnIndex": idx + 1,
            "speakerId": f"SPEAKER_{spk_id + 1}",
            "speakerName": spk_name,
            "startTimeSec": start,
            "endTimeSec": end,
            "start": format_timestamp(start),
            "end": format_timestamp(end),
            "duration": duration,
            "audioUrl": turn_url
        }
        chronological_timeline.append(turn_item)

        if spk_id not in speakers_dict:
            speakers_dict[spk_id] = {
                "id": f"SPEAKER_{spk_id + 1}",
                "name": spk_name,
                "role": "Host" if spk_id == 0 else "Participant",
                "totalSpokenSec": 0.0,
                "turnCount": 0,
                "turns": []
            }

        speakers_dict[spk_id]["totalSpokenSec"] += duration
        speakers_dict[spk_id]["turnCount"] += 1
        speakers_dict[spk_id]["turns"].append(turn_item)

    # Generate combined audio track for each speaker
    speakers_list = []
    for spk_id, spk_data in sorted(speakers_dict.items()):
        spk_data["totalSpokenSec"] = round(spk_data["totalSpokenSec"], 2)
        percentage = round((spk_data["totalSpokenSec"] / max(total_duration_sec, 1.0)) * 100, 1)
        spk_data["speakingPercentage"] = percentage
        spk_data["formattedSpokenTime"] = format_timestamp(spk_data["totalSpokenSec"])
        
        # Build consolidated audio of all turns for this speaker
        speaker_intervals = [(t["startTimeSec"], t["endTimeSec"]) for t in spk_data["turns"]]
        spk_full_filename = f"speaker_{spk_id + 1}_full.wav"
        spk_full_path = os.path.join(session_audio_dir, spk_full_filename)
        create_speaker_consolidated_wav(master_wav_path, spk_full_path, speaker_intervals)
        spk_data["fullAudioUrl"] = f"/api/audio/stream/{video_id}/{spk_full_filename}"
        
        # Primary sample audio for this speaker
        if spk_data["turns"]:
            spk_data["sampleAudioUrl"] = spk_data["turns"][0]["audioUrl"]
        else:
            spk_data["sampleAudioUrl"] = spk_data["fullAudioUrl"]

        # Run unbiased behavioral & acoustic analysis algorithms
        is_host = (spk_data["role"] == "Host" or spk_id == 0)
        spk_analytics = analyze_speaker_acoustics(
            samples=samples,
            sr=sr,
            turns=spk_data["turns"],
            total_meeting_sec=total_duration_sec,
            total_meeting_turns=len(chronological_timeline),
            speaker_count=len(speakers_dict),
            is_host=is_host
        )
        spk_data["analytics"] = spk_analytics
        
        speakers_list.append(spk_data)

    silence_duration = max(0.0, round(total_duration_sec - total_speech_time, 2))
    meeting_insights = generate_meeting_insights(speakers_list, total_duration_sec)

    return {
        "videoId": video_id,
        "masterAudioUrl": f"/api/audio/stream/{video_id}/master_audio.wav",
        "totalDurationSec": round(total_duration_sec, 2),
        "totalDurationFormatted": format_timestamp(total_duration_sec),
        "totalSpeechSec": round(total_speech_time, 2),
        "silenceDurationSec": silence_duration,
        "silencePercentage": round((silence_duration / max(total_duration_sec, 1.0)) * 100, 1),
        "speakerCount": len(speakers_list),
        "speakers": speakers_list,
        "timeline": chronological_timeline,
        "meetingInsights": meeting_insights
    }
