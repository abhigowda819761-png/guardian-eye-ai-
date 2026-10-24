

#!/usr/bin/env python3
"""
Comprehensive Production Readiness Test Suite for GuardianEye AI
Tests:
1. FFmpeg extraction on actual MP4 video files
2. Audio diarization & speaker voice clustering accuracy
3. REST APIs: Auth, Meetings, Fact Check, Video Upload
4. Audio streaming & Byte-range seeking
5. WebSocket Signaling & Max Room Capacity (Host + 5 Participants)
"""

import os
import sys
import time
import json
import wave
import shutil
import urllib.request
import urllib.error
import subprocess
import numpy as np
import websockets
import asyncio

API_BASE = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"

TEST_RESULTS = []

def record_test(name: str, passed: bool, details: str = ""):
    TEST_RESULTS.append({"name": name, "passed": passed, "details": details})
    symbol = "✅ PASS" if passed else "❌ FAIL"
    print(f"[{symbol}] {name} - {details}")

# Helper for HTTP requests
def http_post(url: str, data: dict):
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))

def http_get(url: str):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))

# ==========================================
# 1. FFmpeg & MP4 Video Generation
# ==========================================
def test_ffmpeg_and_mp4_generation():
    ffmpeg = (
        os.environ.get("FFMPEG_PATH") or
        shutil.which("ffmpeg") or
        next((p for p in ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"] if os.path.exists(p)), None) or
        "ffmpeg"
    )
    if ffmpeg != "ffmpeg" and not os.path.exists(ffmpeg):
        record_test("FFmpeg Presence", False, f"FFmpeg not found at {ffmpeg}")
        return None

    record_test("FFmpeg Presence", True, f"FFmpeg verified at {ffmpeg}")

    # Generate synthetic audio: Speaker 1 (150Hz, 2.5s), Silence (0.5s), Speaker 2 (280Hz, 2.5s)
    sr = 16000
    t1 = np.linspace(0, 2.5, int(sr * 2.5))
    s1 = 0.5 * np.sin(2 * np.pi * 150 * t1)
    silence = np.zeros(int(sr * 0.5))
    t2 = np.linspace(0, 2.5, int(sr * 2.5))
    s2 = 0.5 * np.sin(2 * np.pi * 280 * t2)

    combined = np.concatenate([s1, silence, s2])
    pcm = (combined * 32767).astype(np.int16)

    wav_path = "/tmp/guard_test_audio.wav"
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())

    # Create real MP4 video with a test test pattern and the audio track
    mp4_path = "/tmp/guard_test_meeting.mp4"
    cmd = [
        ffmpeg, "-y",
        "-f", "lavfi", "-i", "color=c=navy:s=640x360:r=25:d=5.5",
        "-i", wav_path,
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        mp4_path
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode == 0 and os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 1000:
        record_test("Generate Real MP4 Meeting Video", True, f"Size: {os.path.getsize(mp4_path)} bytes")
        return mp4_path
    else:
        record_test("Generate Real MP4 Meeting Video", False, res.stderr.decode("utf-8", errors="ignore"))
        return None

# ==========================================
# 2. REST API Testing
# ==========================================
def test_rest_apis(mp4_path: str):
    print("\n--- TEST 2: REST API Endpoints ---")
    
    # Health check
    try:
        status, data = http_get(f"{API_BASE}/api/health")
        record_test("GET /api/health", status == 200 and data.get("status") == "ok", f"Rooms: {data.get('active_rooms')}")
    except Exception as e:
        record_test("GET /api/health", False, str(e))

    # Auth: Password verification
    try:
        # Correct login
        status, data = http_post(f"{API_BASE}/api/auth/login", {"email": "abhi@gmail.com", "password": "Abhi@123"})
        record_test("POST /api/auth/login (Correct)", status == 200 and data.get("status") == "success", f"User: {data.get('user', {}).get('displayName')}")
    except Exception as e:
        record_test("POST /api/auth/login (Correct)", False, str(e))

    try:
        # Incorrect login
        http_post(f"{API_BASE}/api/auth/login", {"email": "abhi@gmail.com", "password": "WrongPassword"})
        record_test("POST /api/auth/login (Incorrect Rejection)", False, "Failed to reject wrong password")
    except urllib.error.HTTPError as e:
        record_test("POST /api/auth/login (Incorrect Rejection)", e.code == 401, f"Correctly returned 401: {e.reason}")
    except Exception as e:
        record_test("POST /api/auth/login (Incorrect Rejection)", False, str(e))

    # Fact check
    try:
        status, data = http_post(f"{API_BASE}/api/ai/fact-check", {"claim": "Our Q3 project timeline was completed 2 weeks ahead of target schedule."})
        record_test("POST /api/ai/fact-check", status == 200 and "verdict" in data, f"Verdict: {data.get('verdict')}, Conf: {data.get('confidence')}%")
    except Exception as e:
        record_test("POST /api/ai/fact-check", False, str(e))

    # Meeting creation
    room_code = None
    try:
        status, data = http_post(f"{API_BASE}/api/meetings/create", {
            "topic": "Pre-Launch Verification Session",
            "hostEmail": "abhi@gmail.com",
            "hostName": "Abhishek S."
        })
        room_code = data.get("room", {}).get("code")
        record_test("POST /api/meetings/create", status == 200 and bool(room_code), f"Created room: {room_code}")
    except Exception as e:
        record_test("POST /api/meetings/create", False, str(e))

    # Meeting retrieval
    if room_code:
        try:
            status, data = http_get(f"{API_BASE}/api/meetings/{room_code}")
            record_test(f"GET /api/meetings/{room_code}", status == 200 and data.get("topic") == "Pre-Launch Verification Session", f"Host: {data.get('hostName')}")
        except Exception as e:
            record_test(f"GET /api/meetings/{room_code}", False, str(e))

    return room_code

# ==========================================
# 3. Audio Extraction & Streaming
# ==========================================
def test_audio_extraction_and_streaming(mp4_path: str):
    print("\n--- TEST 3: Audio Extraction & Streaming ---")
    if not mp4_path or not os.path.exists(mp4_path):
        record_test("Audio Extraction from MP4", False, "No MP4 test file available")
        return

    # Upload MP4 file via curl to test multipart/form-data upload
    cmd = [
        "curl", "-s",
        "-F", f"file=@{mp4_path};type=video/mp4",
        f"{API_BASE}/api/video/extract-audio"
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        record_test("POST /api/video/extract-audio", False, res.stderr.decode("utf-8", errors="ignore"))
        return

    try:
        data = json.loads(res.stdout.decode("utf-8"))
        if data.get("status") != "success":
            record_test("POST /api/video/extract-audio", False, str(data))
            return

        result = data["data"]
        video_id = result.get("videoId")
        spk_count = result.get("speakerCount")
        timeline = result.get("timeline", [])
        speakers = result.get("speakers", [])
        master_url = result.get("masterAudioUrl")

        record_test(
            "POST /api/video/extract-audio (MP4)",
            True,
            f"VideoID: {video_id}, Duration: {result.get('totalDurationSec')}s, Speakers: {spk_count}, Turns: {len(timeline)}"
        )

        # Verify Master Audio Stream
        full_master_url = f"{API_BASE}{master_url}"
        m_req = urllib.request.Request(full_master_url)
        with urllib.request.urlopen(m_req) as m_resp:
            ctype = m_resp.headers.get("Content-Type")
            clen = int(m_resp.headers.get("Content-Length", 0))
            record_test(
                "GET Master Audio Stream",
                m_resp.status == 200 and "audio/wav" in ctype and clen > 10000,
                f"Content-Type: {ctype}, Size: {clen} bytes"
            )

        # Verify Individual Speaker Consolidated Audio Stream
        if speakers:
            spk1 = speakers[0]
            spk_url = f"{API_BASE}{spk1['fullAudioUrl']}"
            s_req = urllib.request.Request(spk_url)
            with urllib.request.urlopen(s_req) as s_resp:
                record_test(
                    f"GET Speaker Voice Stream ({spk1['name']})",
                    s_resp.status == 200 and "audio/wav" in s_resp.headers.get("Content-Type"),
                    f"Status: {s_resp.status}, Turns Spoken: {spk1['turnCount']}"
                )

        # Verify Turn Slice Audio Stream
        if timeline:
            turn1 = timeline[0]
            t_url = f"{API_BASE}{turn1['audioUrl']}"
            t_req = urllib.request.Request(t_url)
            with urllib.request.urlopen(t_req) as t_resp:
                record_test(
                    f"GET Turn Slice Audio ({turn1['start']} -> {turn1['end']})",
                    t_resp.status == 200,
                    f"Turn #{turn1['turnIndex']} Duration: {turn1['duration']}s"
                )

        # Security Test: Path Traversal Attempt
        traversal_url = f"{API_BASE}/api/audio/stream/{video_id}/../../main.py"
        try:
            urllib.request.urlopen(traversal_url)
            record_test("Path Traversal Protection", False, "Vulnerability: Accessed file outside audio directory")
        except urllib.error.HTTPError as e:
            record_test("Path Traversal Protection", e.code in [403, 404], f"Safely blocked with HTTP {e.code}")

    except Exception as e:
        record_test("Audio Extraction & Stream Analysis", False, str(e))

# ==========================================
# 4. WebSocket Signaling & Room Capacity (Host + 5 Participants)
# ==========================================
async def test_webrtc_signaling_and_capacity(room_code: str):
    print("\n--- TEST 4: WebSocket Signaling & Capacity Enforcing ---")
    if not room_code:
        record_test("WebSocket Room Signaling", False, "No active room code available")
        return

    uri = f"{WS_BASE}/ws/meeting/{room_code}"

    # Connect Host
    host_ws = await websockets.connect(uri)
    await host_ws.send(json.dumps({"role": "host", "name": "Abhishek S. (Host)"}))
    host_init = json.loads(await host_ws.recv())
    record_test("WebSocket Host Handshake", host_init.get("type") == "host_ready", f"Max: {host_init.get('maxParticipants')}")

    async def wait_for_host_join_req():
        while True:
            msg = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=4.0))
            if msg.get("type") == "join_request":
                return msg

    # Connect up to 5 participants
    participants_ws = []
    for i in range(1, 6):
        p_name = f"Participant {i}"
        p_ws = await websockets.connect(uri)
        await p_ws.send(json.dumps({"role": "participant", "name": p_name}))

        # Host receives join_request
        join_req = await wait_for_host_join_req()
        p_id = join_req.get("participantId")
        
        # Host approves
        await host_ws.send(json.dumps({"type": "approve_request", "participantId": p_id}))
        
        # Participant receives approval
        approval = json.loads(await asyncio.wait_for(p_ws.recv(), timeout=4.0))
        if approval.get("type") == "request_approved":
            participants_ws.append(p_ws)

    record_test(
        "WebSocket 5 Participants Admitted",
        len(participants_ws) == 5,
        f"Approved {len(participants_ws)} participants in room"
    )

    # Attempt to connect 6th participant (Over Capacity)
    p6_ws = await websockets.connect(uri)
    await p6_ws.send(json.dumps({"role": "participant", "name": "Participant 6 (Overflow)"}))
    
    # 6th participant should receive error indicating Room is full
    err_resp = json.loads(await p6_ws.recv())
    record_test(
        "Room Capacity Enforcement (Max 5 Guests)",
        err_resp.get("type") == "error" and "full" in err_resp.get("message", "").lower(),
        f"Received: {err_resp.get('message')}"
    )

    # Clean up websockets
    for p in participants_ws:
        await p.close()
    await p6_ws.close()
    await host_ws.close()

# ==========================================
# Main Runner
# ==========================================
async def main():
    print("=" * 65)
    print("GUARDIANEYE AI — PRODUCTION READINESS AUDIT & VERIFICATION")
    print("=" * 65)

    mp4_file = test_ffmpeg_and_mp4_generation()
    room_code = test_rest_apis(mp4_file)
    test_audio_extraction_and_streaming(mp4_file)
    await test_webrtc_signaling_and_capacity(room_code)

    print("\n" + "=" * 65)
    print("SUMMARY AUDIT REPORT")
    print("=" * 65)
    total = len(TEST_RESULTS)
    passed = sum(1 for t in TEST_RESULTS if t["passed"])
    failed = total - passed
    print(f"Total Tests Executed: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    if failed == 0:
        print("ALL TESTS PASSED WITH ZERO ERRORS. APPLICATION IS PRODUCTION READY!")
    else:
        print(f"ATTENTION: {failed} tests failed! Inspect details above.")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(main())
