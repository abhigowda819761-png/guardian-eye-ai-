#!/usr/bin/env python3
"""
End-to-End Automated Pipeline & Analytical Validation Test
Simulates an executive technical interview between James and Hassassin.
Tests serverless endpoints, speaker diarization formatting, Gemini analytical schemas,
and fact-checking accuracy verdicts.
"""

import json
import urllib.request
import urllib.error
import sys

BASE_URL = "http://localhost:8000"

MOCK_INTERVIEW_TRANSCRIPT = """James: Welcome Hassassin to the technical interview. Can you walk us through the memory architecture of our WebRTC audio pipeline and how frame drops are prevented under 500kbps bitrate caps?
Hassassin: We use ring buffers in WebAudio with a 48kHz to 16kHz resampler and WebAssembly hardware acceleration to maintain latency consistently under 45ms with zero packet loss.
James: What about thread contention in high-concurrency mobile APK environments when screen capture and mic audio record simultaneously?
Hassassin: Well, um, we are evaluating background worker isolates, but tentatively we use asynchronous non-blocking queues.
James: Have you completed the security hardening for Cloud Firestore rules to prevent unauthorized transcript reads?
Hassassin: Yes, every document path is locked under request.auth.uid equals resource.data.userId with strict read and write assertions.
James: Are there any pending regulatory or security blockers before our Play Store release?
Hassassin: Maybe we need one more internal pass, not sure about the exact timeline yet."""

def post_json(endpoint, data):
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode("utf-8"))

def run_tests():
    print("=" * 70)
    print("  GUARDIANEYE AI: END-TO-END PIPELINE & FACT-CHECK AUDIT TEST")
    print("=" * 70)

    # 1. Test Unified Serverless Endpoint
    print("\n[TEST 1] Testing /api/firebase/generate-meeting-transcription...")
    payload_1 = {
        "meetingId": "e2e_interview_test_001",
        "hostName": "James",
        "participantNames": ["Hassassin"],
        "rawTranscript": MOCK_INTERVIEW_TRANSCRIPT
    }

    res_1 = post_json("/api/firebase/generate-meeting-transcription", payload_1)
    assert res_1.get("success") is True, "Expected success: True"
    assert res_1.get("transcriptionStatus") == "completed", "Expected transcriptionStatus: completed"
    print("  ✓ Serverless orchestration endpoint returned HTTP 200 with completed status")

    # 2. Validate Chronological Movie-Script Transcript Dialogue
    print("\n[TEST 2] Validating Movie-Script Dialogue Formatting...")
    raw_transcript = res_1.get("rawTranscript", "")
    assert "James:" in raw_transcript, "Missing James speaker label"
    assert "Hassassin:" in raw_transcript, "Missing Hassassin speaker label"
    lines = [l for l in raw_transcript.split("\n") if l.strip()]
    assert len(lines) >= 6, f"Expected at least 6 turns, got {len(lines)}"
    print(f"  ✓ Transcript structured cleanly with {len(lines)} movie-script dialogue turns")

    # 3. Validate Gemini 1.5 Flash 5-Metric Speaker Ratings Schema
    print("\n[TEST 3] Validating 5-Metric Speaker Ratings Schema (1-10 Integers)...")
    ratings = res_1.get("speakerRatings", {})
    assert "James" in ratings, "Missing James in speakerRatings"
    assert "Hassassin" in ratings, "Missing Hassassin in speakerRatings"

    required_metrics = [
        "communication_skills",
        "fluency",
        "confidence",
        "awkwardness",
        "straightforward_answers"
    ]

    for spk in ["James", "Hassassin"]:
        spk_scores = ratings[spk]
        for m in required_metrics:
            assert m in spk_scores, f"Missing metric '{m}' for {spk}"
            val = spk_scores[m]
            assert isinstance(val, int), f"Metric '{m}' must be integer, got {type(val)}"
            assert 1 <= val <= 10, f"Metric '{m}' value {val} outside 1-10 range"
        print(f"  ✓ Speaker '{spk}' scored across all 5 metrics:")
        for m in required_metrics:
            print(f"      - {m}: {spk_scores[m]}/10")

    # 4. Validate Fact-Checking & Q&A Audit Schema & Accuracy Verdicts
    print("\n[TEST 4] Validating Fact-Checking & Q&A Audit Payload...")
    audit = res_1.get("factCheckAudit", [])
    assert isinstance(audit, list), "factCheckAudit must be a list"
    assert len(audit) >= 3, f"Expected at least 3 audit items, got {len(audit)}"

    verdicts_found = set()
    for idx, item in enumerate(audit, 1):
        assert "question_by" in item, "Missing question_by"
        assert "question" in item, "Missing question"
        assert "answered_by" in item, "Missing answered_by"
        assert "answer" in item, "Missing answer"
        assert "verdict" in item, "Missing verdict"
        assert item["verdict"] in ["Accurate", "Incomplete", "Evasive"], f"Invalid verdict: {item['verdict']}"
        verdicts_found.add(item["verdict"])
        print(f"  ✓ Q&A Audit #{idx}:")
        print(f"      Q by {item['question_by']}: \"{item['question'][:50]}...\"")
        print(f"      A by {item['answered_by']}: \"{item['answer'][:50]}...\"")
        print(f"      Verdict: [{item['verdict']}]")

    print(f"\n  ✓ Verified verdicts captured across mock conversation: {verdicts_found}")

    # 5. Test Dedicated Fact-Check Standalone Endpoint
    print("\n[TEST 5] Testing Dedicated /api/firebase/audit-meeting-fact-check endpoint...")
    res_2 = post_json("/api/firebase/audit-meeting-fact-check", {
        "meetingId": "e2e_interview_test_001",
        "rawTranscript": MOCK_INTERVIEW_TRANSCRIPT,
        "hostName": "James",
        "participantNames": ["Hassassin"]
    })
    assert res_2.get("success") is True, "Expected success: True"
    assert len(res_2.get("factCheckAudit", [])) >= 3, "Expected audit items returned"
    print("  ✓ Dedicated fact-check audit endpoint passed successfully")

    print("\n" + "=" * 70)
    print("  ALL 5 END-TO-END PIPELINE VALIDATION CHECKS PASSED (100% OPERATIONAL)")
    print("=" * 70)

if __name__ == "__main__":
    try:
        run_tests()
    except Exception as e:
        print(f"\n❌ TEST FAILED: {str(e)}", file=sys.stderr)
        sys.exit(1)
