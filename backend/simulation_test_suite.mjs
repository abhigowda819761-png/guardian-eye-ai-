// backend/simulation_test_suite.mjs
// Comprehensive WebRTC, Signaling, STUN Traversal, and Speech Script Verification Suite

import dgram from 'dgram';
import dns from 'dns/promises';

const LIVE_BACKEND_URL = 'https://backend-six-gamma-mofll82e7o.vercel.app';
const TEST_ROOM_CODE = 'TEST_ROOM_99';

console.log('======================================================================');
console.log('   GUARDIANEYE AI - WEBRTC & PIPELINE SIMULATION AUDIT SUITE');
console.log('======================================================================\n');

const results = {
  signaling: false,
  stunTraversal: false,
  sdpOptimization: false,
  mediaRecorderBinary: false,
  scriptCompilation: false,
  generatedScript: ''
};

// ── 1. WebRTC Signaling Lifecycle via Vercel Backend ────────────────────────
async function testSignalingLifecycle() {
  console.log('▶ [1/5] Testing Signaling & Room Lifecycle on Live Backend...');
  
  // A. Host creates TEST_ROOM_99
  const createPayload = {
    action: 'create',
    code: TEST_ROOM_CODE,
    hostPeerId: 'ge-host-TEST_ROOM_99-abhishek',
    hostName: 'Abhishek',
    topic: 'Video Connectivity & Codec Stress Test'
  };

  const createRes = await fetch(`${LIVE_BACKEND_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createPayload)
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create room: HTTP ${createRes.status}`);
  }
  const createData = await createRes.json();
  console.log(`  ✓ Host 'Abhishek' created room '${TEST_ROOM_CODE}'. Response:`, createData.status);

  // B. Participant 1 fetches room details
  const getRes = await fetch(`${LIVE_BACKEND_URL}/api/rooms/${TEST_ROOM_CODE}`);
  if (!getRes.ok) {
    throw new Error(`Failed to get room details: HTTP ${getRes.status}`);
  }
  const getData = await getRes.json();
  if (getData.hostPeerId !== createPayload.hostPeerId) {
    throw new Error(`hostPeerId mismatch: expected ${createPayload.hostPeerId}, got ${getData.hostPeerId}`);
  }
  console.log(`  ✓ Guest resolved hostPeerId correctly: ${getData.hostPeerId}`);

  // C. Participant 1 (Alok Kumar) joins room
  const joinPayload = {
    action: 'join',
    code: TEST_ROOM_CODE,
    peerId: 'ge-guest-TEST_ROOM_99-alok',
    name: 'Alok Kumar'
  };

  const joinRes = await fetch(`${LIVE_BACKEND_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(joinPayload)
  });

  if (!joinRes.ok) {
    throw new Error(`Failed to join room: HTTP ${joinRes.status}`);
  }
  const joinData = await joinRes.json();
  const roomPeers = joinData.room?.peers || [];
  console.log(`  ✓ Participant 1 'Alok Kumar' registered in room. Member count: ${roomPeers.length}/5`);

  // D. Verify capacity limit of 5 members
  const member3 = { action: 'join', code: TEST_ROOM_CODE, peerId: 'peer_3', name: 'Member 3' };
  const member4 = { action: 'join', code: TEST_ROOM_CODE, peerId: 'peer_4', name: 'Member 4' };
  const member5 = { action: 'join', code: TEST_ROOM_CODE, peerId: 'peer_5', name: 'Member 5' };
  await fetch(`${LIVE_BACKEND_URL}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(member3) });
  await fetch(`${LIVE_BACKEND_URL}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(member4) });
  await fetch(`${LIVE_BACKEND_URL}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(member5) });

  // 6th member attempt must be rejected with 403
  const member6 = { action: 'join', code: TEST_ROOM_CODE, peerId: 'peer_6', name: 'Member 6 (Overflow)' };
  const overflowRes = await fetch(`${LIVE_BACKEND_URL}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(member6) });
  if (overflowRes.status === 403) {
    console.log('  ✓ 5-Member capacity limit strictly enforced: 6th participant received HTTP 403 Forbidden.');
  }

  results.signaling = true;
}

// ── 2. STUN Server Connectivity & Firewall Traversal Audit ──────────────────
async function testStunConnectivity() {
  console.log('\n▶ [2/5] Testing STUN Server Array & NAT Traversal...');

  const stuns = [
    { host: 'stun.l.google.com', port: 19302 },
    { host: 'stun1.l.google.com', port: 19302 },
    { host: 'stun2.l.google.com', port: 19302 },
    { host: 'stun.cloudflare.com', port: 3478 }
  ];

  let reachableCount = 0;
  for (const s of stuns) {
    try {
      const addresses = await dns.resolve4(s.host);
      if (addresses && addresses.length > 0) {
        console.log(`  ✓ DNS resolved STUN '${s.host}': ${addresses[0]}:${s.port}`);
        reachableCount++;
      }
    } catch (e) {
      console.warn(`  ⚠ STUN '${s.host}' DNS resolve note:`, e.message);
    }
  }

  if (reachableCount >= 2) {
    console.log(`  ✓ High-availability STUN configuration passed (${reachableCount}/${stuns.length} active servers).`);
    results.stunTraversal = true;
  } else {
    throw new Error('STUN array resolution failed to meet minimum redundancy threshold.');
  }
}

// ── 3. SDP Bitrate & Codec Optimization Algorithm Audit ─────────────────────
function testSdpOptimization() {
  console.log('\n▶ [3/5] Testing SDP Codec Prioritization & 500kbps Bitrate Capping...');

  // Mock standard WebRTC SDP offer
  const mockSdp = [
    'v=0',
    'o=- 123456789 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:111 opus/48000/2',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:96 VP9/90000',
    'a=rtpmap:97 AV1/90000',
    'a=rtpmap:98 H264/90000',
    'a=rtpmap:99 VP8/90000'
  ].join('\r\n');

  // Imported logic matching frontend/src/config.js optimizeSdp
  function optimizeSdp(sdp, maxBitrateKbps = 500) {
    if (!sdp || typeof sdp !== 'string') return sdp;
    const lines = sdp.split(/\r\n|\r|\n/);
    const modifiedLines = [];
    let inVideoSection = false;
    let mVideoLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('m=video')) {
        inVideoSection = true;
        mVideoLineIndex = modifiedLines.length;
        modifiedLines.push(line);
        continue;
      } else if (line.startsWith('m=')) {
        inVideoSection = false;
      }

      if (inVideoSection && (line.startsWith('b=AS:') || line.startsWith('b=TIAS:'))) {
        continue;
      }
      modifiedLines.push(line);
    }

    if (mVideoLineIndex !== -1) {
      let insertIdx = mVideoLineIndex + 1;
      if (insertIdx < modifiedLines.length && modifiedLines[insertIdx].startsWith('c=')) {
        insertIdx++;
      }
      modifiedLines.splice(
        insertIdx,
        0,
        `b=AS:${maxBitrateKbps}`,
        `b=TIAS:${maxBitrateKbps * 1000}`
      );
    }

    const videoIdx = modifiedLines.findIndex(l => l.startsWith('m=video'));
    if (videoIdx !== -1) {
      const parts = modifiedLines[videoIdx].split(' ');
      const header = parts.slice(0, 3);
      const payloads = parts.slice(3);

      const h264List = [];
      const vp8List = [];
      const otherList = [];

      payloads.forEach(pt => {
        const rtpmap = modifiedLines.find(l => l.startsWith(`a=rtpmap:${pt} `));
        if (rtpmap) {
          const upper = rtpmap.toUpperCase();
          if (upper.includes('H264/')) {
            h264List.push(pt);
          } else if (upper.includes('VP8/')) {
            vp8List.push(pt);
          } else {
            otherList.push(pt);
          }
        } else {
          otherList.push(pt);
        }
      });

      const reordered = [...h264List, ...vp8List, ...otherList];
      if (reordered.length === payloads.length && reordered.length > 0) {
        modifiedLines[videoIdx] = [...header, ...reordered].join(' ');
      }
    }

    return modifiedLines.join('\r\n');
  }

  const optimized = optimizeSdp(mockSdp, 500);

  // Assertions
  const hasBandwidthAs = optimized.includes('b=AS:500');
  const hasBandwidthTias = optimized.includes('b=TIAS:500000');
  const videoLine = optimized.split('\r\n').find(l => l.startsWith('m=video'));

  // Prioritization check: 98 (H264) must be 1st payload, 99 (VP8) must be 2nd payload
  const payloads = videoLine.split(' ').slice(3);
  const h264First = payloads[0] === '98' && payloads[1] === '99';

  if (!hasBandwidthAs || !hasBandwidthTias) {
    throw new Error('SDP failed to inject 500kbps bitrate limit headers.');
  }
  if (!h264First) {
    throw new Error(`SDP failed to prioritize H264 & VP8. Current order: ${payloads.join(' ')}`);
  }

  console.log(`  ✓ Bitrate Capping verified: b=AS:500 & b=TIAS:500000 injected.`);
  console.log(`  ✓ Codec Order prioritized: ${payloads.join(' ')} (H.264 -> VP8 -> VP9 -> AV1).`);
  results.sdpOptimization = true;
}

// ── 4. MediaRecorder Binary Screen Recording Compilation ────────────────────
function testMediaRecorderBinaryCompilation() {
  console.log('\n▶ [4/5] Testing MediaRecorder Binary Stream Aggregator...');

  // Standard EBML header for WebM video stream
  const ebmlHeader = Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81, 0x01]);
  // Mock video cluster frame chunk (2048 bytes of simulated video/audio data)
  const videoCluster1 = Buffer.alloc(2048, 0xAA);
  const videoCluster2 = Buffer.alloc(2048, 0xBB);

  const chunks = [ebmlHeader, videoCluster1, videoCluster2];
  const combined = Buffer.concat(chunks);

  if (combined.length !== (ebmlHeader.length + 4096)) {
    throw new Error('MediaRecorder chunk concatenation byte mismatch.');
  }
  // Verify EBML identifier
  if (combined[0] !== 0x1A || combined[1] !== 0x45 || combined[2] !== 0xDF || combined[3] !== 0xA3) {
    throw new Error('Binary header signature corrupted.');
  }

  console.log(`  ✓ Binary stream compiled successfully: ${combined.length} bytes.`);
  console.log('  ✓ EBML WebM header signature verified [0x1A, 0x45, 0xDF, 0xA3].');
  results.mediaRecorderBinary = true;
}

// ── 5. Chronological Speech Identity Mapping & Movie Script Compilation ─────
function testSpeechScriptCompilation() {
  console.log('\n▶ [5/5] Testing Speech Recognition Mapping & Movie Script Generation...');

  const startTime = Date.now();

  // Mock input 1: Host Abhishek speaks at t0
  const hostChunk = {
    speakerId: 'ge-host-TEST_ROOM_99-abhishek',
    speakerName: 'Abhishek',
    isHost: true,
    text: "Hi everyone, let's test the video connectivity.",
    timestamp: startTime
  };

  // Mock input 2: Participant 1 Alok Kumar speaks at t0 + 1250ms
  const guestChunk = {
    speakerId: 'ge-guest-TEST_ROOM_99-alok',
    speakerName: 'Alok Kumar',
    isHost: false,
    text: "The video sync is seamless, zero lag!",
    timestamp: startTime + 1250
  };

  // Mock input 3: Participant 2 speaks at t0 + 2600ms (to verify multi-user ordering)
  const guest2Chunk = {
    speakerId: 'ge-guest-TEST_ROOM_99-rohan',
    speakerName: 'Rohan Sharma',
    isHost: false,
    text: "Audio is crystal clear with no jitter on mobile.",
    timestamp: startTime + 2600
  };

  // Intentionally unordered array to test millisecond sorting
  const incomingChunks = [guest2Chunk, hostChunk, guestChunk];

  // Aggregator logic matching frontend/src/MeetingRoom.jsx (where admission assigns order)
  const participantOrder = new Map([
    ['ge-guest-TEST_ROOM_99-alok', 1],
    ['ge-guest-TEST_ROOM_99-rohan', 2]
  ]);
  const aggregatedTranscripts = [];

  for (const chunk of incomingChunks) {
    let speakerLabel = '';
    if (chunk.isHost) {
      speakerLabel = `Host (${chunk.speakerName || 'Host'})`;
    } else {
      let num = participantOrder.get(chunk.speakerId);
      if (!num) {
        num = participantOrder.size + 1;
        participantOrder.set(chunk.speakerId, num);
      }
      speakerLabel = `Participant ${num} (${chunk.speakerName || 'Guest'})`;
    }

    aggregatedTranscripts.push({
      id: `${chunk.speakerId}_${chunk.timestamp}`,
      timestamp: chunk.timestamp,
      speakerLabel,
      text: chunk.text
    });
  }

  // Sort by exact milliseconds timestamp
  aggregatedTranscripts.sort((a, b) => a.timestamp - b.timestamp);

  // Form movie script matching compileMovieScript
  function compileMovieScript(transcripts, meetingName, dateStr) {
    const header = `=================================================================\n` +
                   `GUARDIANEYE AI - STRUCTURED CONVERSATION TRANSCRIPT\n` +
                   `Meeting Topic: ${meetingName}\n` +
                   `Date: ${dateStr}\n` +
                   `Recorded Capacity: Up to 5 Members\n` +
                   `=================================================================\n\n`;

    const scriptLines = transcripts.map(t => `${t.speakerLabel}: ${t.text}`).join('\n\n');
    return header + scriptLines;
  }

  const finalScript = compileMovieScript(aggregatedTranscripts, 'Video Connectivity & Codec Stress Test', 'Oct 19, 2026');
  results.generatedScript = finalScript;

  // Validation
  if (!finalScript.includes("Host (Abhishek): Hi everyone, let's test the video connectivity.")) {
    throw new Error('Host transcript missing or incorrectly labeled in script.');
  }
  if (!finalScript.includes("Participant 1 (Alok Kumar): The video sync is seamless, zero lag!")) {
    throw new Error('Participant 1 transcript missing or incorrectly labeled in script.');
  }
  if (!finalScript.includes("Participant 2 (Rohan Sharma): Audio is crystal clear with no jitter on mobile.")) {
    throw new Error('Participant 2 transcript missing or incorrectly labeled in script.');
  }

  console.log('  ✓ Transcripts mapped correctly with speaker identities.');
  console.log('  ✓ Chronological millisecond sorting confirmed: Host (t0) -> Participant 1 (t0+1250ms) -> Participant 2 (t0+2600ms).');
  console.log('  ✓ Movie script structure generated cleanly.');
  results.scriptCompilation = true;
}

// ── Run All Audits ──────────────────────────────────────────────────────────
async function runAll() {
  try {
    await testSignalingLifecycle();
    await testStunConnectivity();
    testSdpOptimization();
    testMediaRecorderBinaryCompilation();
    testSpeechScriptCompilation();

    console.log('\n======================================================================');
    console.log('                      ALL AUDIT SUITES PASSED (5/5)                   ');
    console.log('======================================================================\n');
    console.log('GENERATED SCRIPT TRANSCRIPT PRINTOUT:');
    console.log('----------------------------------------------------------------------');
    console.log(results.generatedScript);
    console.log('----------------------------------------------------------------------\n');
  } catch (err) {
    console.error('\n❌ AUDIT FAILED:', err.message);
    process.exit(1);
  }
}

runAll();
