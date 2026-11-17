/**
 * Guardian Eye AI — Presentation & Viva Master Q&A Guide Downloader & Generator
 * Downloads the pre-compiled high-res master PDF or generates it on-the-fly using jsPDF.
 */

import { jsPDF } from 'jspdf';

const VIVA_QA = [
  {
    part: "PART 1: CORE WORKFLOW, LOGIN & DATA FLOW",
    q: "Q1. What is Guardian Eye AI and how does the end-to-end workflow operate?",
    a: "Guardian Eye AI is an enterprise multimodal video meeting and communication auditing platform. Users choose Host or Participant role, connect in a real-time WebRTC room (supporting up to 5 members) or upload a meeting video. FFmpeg extracts clean 16kHz mono audio, Groq Whisper Large-V3 transcribes verbatim dialogue, 6D acoustic clustering isolates who spoke what, and Google Gemini Flash grades each speaker out of 10 and audits all Q&A fact-checking."
  },
  {
    part: "PART 1: CORE WORKFLOW, LOGIN & DATA FLOW",
    q: "Q2. What is the complete Data Flow across the system?",
    a: "Data flows across 4 architectural layers: 1) Client Layer (React 19 + Vite on Port 5173) for media streams and UI; 2) Signaling Layer (Node.js PeerJS on Port 9000) for room routing and WebRTC handshakes; 3) Core AI Layer (FastAPI on Port 8000) for Bcrypt auth, FFmpeg extraction, Groq transcription, and Gemini scoring; 4) Persistence Layer (SQLite guardianeye.db, IndexedDB for video blobs, and localStorage/Firestore for reports)."
  },
  {
    part: "PART 1: CORE WORKFLOW, LOGIN & DATA FLOW",
    q: "Q3. How does User Login work, how is Gmail ID verified, and where is the password stored?",
    a: "The frontend checks strict Gmail format (auto-appending @gmail.com) and requires a minimum 6-character password. Passwords are never stored in plaintext; they are hashed using Bcrypt with 12 adaptive salt rounds (4,096 cycles). On login, Bcrypt verifies the password against the stored hash in the users table of SQLite database guardianeye.db before issuing a session token."
  },
  {
    part: "PART 2: LIVE WEBRTC VIDEO CONFERENCE ROOM & ALGORITHMS",
    q: "Q4. How does clicking 'Create New' work and how does it open the camera?",
    a: "Clicking Create New calls POST /api/meetings/create to register the room and mounts MeetingRoom.jsx. The camera is initialized via a 4-stage hardware fallback: Stage 1 requests 720p HD with echoCancellation and noiseSuppression; Stage 2 falls back to basic video/audio; Stage 3 requests video-only if mic is busy; Stage 4 requests audio-only if no camera exists."
  },
  {
    part: "PART 2: LIVE WEBRTC VIDEO CONFERENCE ROOM & ALGORITHMS",
    q: "Q5. How does the Unique Room Code generation algorithm work?",
    a: "Room codes use an unambiguous 6-character Base-32 alphanumeric sampling algorithm formatted as XXX-XXX (e.g. W4K-9P2). Characters are sampled from ABCDEFGHJKLMNPQRSTUVWXYZ23456789, deliberately excluding ambiguous characters 0, O, 1, and I so codes are never misread. Meeting links auto-fill the code for joining participants."
  },
  {
    part: "PART 2: LIVE WEBRTC VIDEO CONFERENCE ROOM & ALGORITHMS",
    q: "Q6. How does the Join Request ('Knock') work when a Participant joins?",
    a: "The participant's browser retrieves the Host's peer ID and opens a reliable WebRTC DataChannel sending a 'knock' packet with their name. The Host receives the event and renders a floating notification card showing the guest's name with Accept and Reject buttons. When approved, the Host verifies room count (< 5) and establishes mesh WebRTC media calls."
  },
  {
    part: "PART 2: LIVE WEBRTC VIDEO CONFERENCE ROOM & ALGORITHMS",
    q: "Q7. What algorithms connect multiple users' video and audio smoothly over the internet?",
    a: "Four algorithms ensure smooth video: 1) Full-Mesh P2P with 8 Google and Cloudflare STUN servers for NAT/firewall traversal; 2) SDP Codec Prioritization reordering payloads to use hardware H.264/VP8; 3) Bandwidth Bitrate Capping via RTCRtpSender (500 kbps video, 24 fps, high audio priority); 4) Adaptive Congestion Control polling pc.getStats() every 3.5s to throttle video to 250 kbps if frame drop exceeds 25%."
  },
  {
    part: "PART 2: LIVE WEBRTC VIDEO CONFERENCE ROOM & ALGORITHMS",
    q: "Q8. How does the Microphone button, Default Mute, and Active-Speaker Detection work?",
    a: "Every participant starts with microphone muted by default (audioOn = false, track.enabled = false) upon entering the room. Unmuting broadcasts peer_state across data channels. For active speaker detection, Web Audio API AnalyserNode measures 128 frequency bins every 100ms; the participant with the highest volume above noise floor (> 14) is highlighted with an active speaker badge."
  },
  {
    part: "PART 2: LIVE WEBRTC VIDEO CONFERENCE ROOM & ALGORITHMS",
    q: "Q9. How does the Record Button work in the live meeting room?",
    a: "Clicking Record captures the full grid via getDisplayMedia. A custom Web Audio API multi-source mixer combines tab system audio, Host local microphone, and all remote peer incoming audio streams into a single destination. MediaRecorder encodes video and mixed audio at 2.5 Mbps into WebM/MP4, saves to IndexedDB, downloads the file, and routes to AI analysis."
  },
  {
    part: "PART 3: STORAGE, VIDEO UPLOAD & AI PIPELINE ALGORITHMS",
    q: "Q10. How does the History section work and where does the app store data?",
    a: "Recorded video files are stored in browser IndexedDB (GuardianEyeRecordingsDB) for zero-latency local playback without cloud bandwidth costs. Meeting summaries, scores, and transcripts are stored in SQLite guardianeye.db and cached in browser localStorage. When cloud mode is active, records also sync to Google Cloud Firestore."
  },
  {
    part: "PART 3: STORAGE, VIDEO UPLOAD & AI PIPELINE ALGORITHMS",
    q: "Q11. How does 'Upload Recorded Meeting' extract audio and detect Who Spoke What?",
    a: "A 4-stage pipeline processes uploaded videos: 1) FFmpeg extracts 16kHz mono WAV (and compact 48kbps MP3 under 15MB for fast base64 payload delivery); 2) Short-time RMS Energy VAD isolates active speech segments; 3) 6D Acoustic Voiceprint Clustering (F0 pitch, spectral centroid, bandwidth, rolloff, ZCR, RMS) groups voices into up to 5 clusters; 4) Google Gemini 2.5 Flash Native Multimodal Audio transcribes verbatim turns, tracks filler words, and binds distinct voices directly to user-entered speaker names."
  },
  {
    part: "PART 3: STORAGE, VIDEO UPLOAD & AI PIPELINE ALGORITHMS",
    q: "Q12. How do the Dual Gemini API Keys work and how are they aligned in the backend?",
    a: "GEMINI_API_KEY_PRIMARY and GEMINI_API_KEY_SECONDARY are configured in backend/.env for intelligent load splitting: the Primary key executes heavy multimodal audio ingestion and 5-speaker acoustic diarization ('Who Spoke What'), while the Secondary key handles cognitive 1-10 parameter scoring, executive summarization, and Q&A fact-checking audits. If either key encounters quota or rate limits, automatic failover instantly routes requests to the alternate key."
  },
  {
    part: "PART 4: SCORING ENGINE, RUBRICS & FACT-CHECKING",
    q: "Q13. How does the Scoring Engine give marks out of 10?",
    a: "Scoring combines pre-computed telemetry (WPM, filler rate %, pauses 1.8-8.0s) with Gemini AI auditing. It scores 5 integer parameters (1-10): Communication Skills, Fluency, Confidence, Awkwardness (inverted: 1 is smooth, higher penalizes fillers/pauses), and Straightforward Answers. Strict guardrails clamp scores to 1.0 if speech is under 4 words, with automated deductions for filler density > 6% or hesitation pauses."
  },
  {
    part: "PART 4: SCORING ENGINE, RUBRICS & FACT-CHECKING",
    q: "Q14. How does the Fact-Checking & Q&A Audit engine work?",
    a: "The engine scans dialogue for questions (? or interrogatives What, How, Why, When, Where, Who, Can, Could) and pairs them with the respondent's answer. It classifies answers as Accurate (factual and complete), Incomplete (vague or missing key details), or Evasive (deflecting with 'maybe', 'not sure', or dodging). Accuracy percentage is calculated as Accurate Answers / Total Audited Questions."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q15. How do Pin User, Raise Hand, Kick Participant, and Meeting Notes work?",
    a: "Pin User locks the recording indicator and adds a glowing cyan border to a tile. Raise Hand broadcasts an animated ✋ badge to all peers. Host Kick displays a confirmation dialog and sends a kicked packet closing the connection. Meeting Notes provides a floating notepad that autosaves every keystroke to localStorage."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q16. What is the 7-Dimension Communication Coach in the backend?",
    a: "An executive coaching engine (/api/ai/coach) grading on a 0-100 scale across Verbal Clarity (20%), Fluency (15%), Vocabulary Expression (15%), Presentation Structure (15%), Active Listening (15%), Professionalism (10%), and Conciseness (10%). It cites exact quotes and generates actionable practice plans."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q17. How does the local Apple Silicon GPU (MPS) and PyAnnote pipeline work?",
    a: "On Apple Silicon Macs, the backend automatically enables Metal Performance Shaders (torch.device('mps')) for hardware-accelerated local PyAnnote diarization and local Whisper transcription without needing external cloud APIs."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q18. What happens if the backend server or internet is offline during analysis?",
    a: "The browser uses a native Web Audio API fallback engine (audioAnalyzer.js). It decodes audio into memory, calculates 100ms RMS energy windows, runs client-side VAD, encodes 16-bit mono WAV blobs, and renders speaker communication metrics locally."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q19. How does the Multi-Page PDF Report Export work?",
    a: "Clicking Download PDF Report uses html2canvas at Retina scale: 2 to capture the dashboard DOM while hiding action buttons, and jsPDF slices the canvas cleanly into standard A4 pages. On mobile devices, it supports native OS sharing via the Web Share API."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q20. How is the app packaged for Mobile (Android APK & iOS PWA)?",
    a: "For Android, Capacitor (com.guardianeye.ai) bundles the app with camera and audio permissions into a native APK. For iOS and desktop, it functions as a Progressive Web App (PWA) installable directly to the home screen."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q21. How are cloud databases and file storage secured?",
    a: "Firestore and Firebase Storage security rules enforce document-level ownership (request.auth.uid == userId). Backend path traversal protection uses os.path.abspath verification to block unauthorized ../../ directory traversal attempts with HTTP 403 Forbidden."
  },
  {
    part: "PART 5: ADVANCED CAPABILITIES, SECURITY & TESTING",
    q: "Q22. How is the project tested and verified?",
    a: "The project includes 4 automated suites: test_production_suite.py (auth, extraction, room limits), crosscheck_all.py (3-speaker clustering), simulation_test_suite.mjs (WebRTC STUN traversal and SDP constraints), and test_e2e_pipeline.py (full verbatim pipeline)."
  }
];

export async function downloadPresentationPdf() {
  // 1. First attempt: Direct download of pre-rendered, high-fidelity PDF from server / public directory
  const candidateUrls = [
    '/GuardianEye_AI_Presentation_QA_Guide.pdf',
    '/GuardianEye_AI_Presentation_Guide.pdf',
    'http://localhost:5173/GuardianEye_AI_Presentation_QA_Guide.pdf',
    'http://localhost:5173/GuardianEye_AI_Presentation_Guide.pdf'
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 1000) {
          const blobUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = 'GuardianEye_AI_Presentation_QA_Guide.pdf';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1500);
          return true;
        }
      }
    } catch (e) {
      // Continue to next option or jsPDF fallback
    }
  }

  // 2. Fallback: Generate cleanly on client using jsPDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - (margin * 2);

  let currentY = 18;

  const checkPageBreak = (neededHeight) => {
    if (currentY + neededHeight > pageHeight - 16) {
      doc.addPage();
      currentY = 16;
    }
  };

  // Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(margin, currentY, contentWidth, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('GUARDIAN EYE AI — PRESENTATION & VIVA MASTER GUIDE', margin + 6, currentY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('Complete Architectural, Algorithmic & Engineering Master Reference', margin + 6, currentY + 16);

  currentY += 28;

  let currentPart = '';

  VIVA_QA.forEach((item) => {
    if (item.part !== currentPart) {
      currentPart = item.part;
      checkPageBreak(12);
      doc.setFillColor(2, 132, 199); // sky-600
      doc.roundedRect(margin, currentY, contentWidth, 7, 1.5, 1.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(currentPart, margin + 4, currentY + 4.8);
      currentY += 10;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    const splitQ = doc.splitTextToSize(item.q, contentWidth - 4);
    checkPageBreak(splitQ.length * 4.5 + 16);

    doc.text(splitQ, margin + 2, currentY);
    currentY += splitQ.length * 4.5 + 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const splitA = doc.splitTextToSize(item.a, contentWidth - 4);
    checkPageBreak(splitA.length * 4.2 + 6);

    doc.text(splitA, margin + 2, currentY);
    currentY += splitA.length * 4.2 + 6;
  });

  doc.save('GuardianEye_AI_Presentation_QA_Guide.pdf');
  return true;
}

