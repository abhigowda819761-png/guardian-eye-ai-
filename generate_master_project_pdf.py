import os
import html
import subprocess
import sys
import shutil
import time

def find_chrome():
    paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    return shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")

# 57 Core Production Files
ALL_PROJECT_FILES = [
    # ── 1. Backend Core & AI Engines ─────────────────────────────────────────
    ("Backend Core & AI Engines", "backend/main.py", "FastAPI Core Server, Auth, Room Management & REST Endpoints", "python"),
    ("Backend Core & AI Engines", "backend/video_analysis_pipeline.py", "Dual-Key Gemini 2.5 Flash Audio-to-Score, Diarization, Guardrails & Fact-Checking", "python"),
    ("Backend Core & AI Engines", "backend/communication_coach_prompt.py", "Gemini AI System Rubrics, Heuristics, Assertiveness & Tone Prompts", "python"),
    ("Backend Core & AI Engines", "backend/audio_extractor.py", "FFmpeg 16kHz PCM WAV Extraction, 48kbps MP3 Compression & Prosody", "python"),
    ("Backend Core & AI Engines", "backend/diarizer.py", "Voice Activity Detection (VAD) & 6D Acoustic Voiceprint Clustering", "python"),
    ("Backend Core & AI Engines", "backend/speech_analytics.py", "Speech analytics, sentiment, WPM & vocal telemetry metrics", "python"),
    ("Backend Core & AI Engines", "backend/peer_server.js", "WebRTC PeerJS Signaling Server (Port 9000) & Room Broker", "javascript"),
    ("Backend Core & AI Engines", "backend/simulation_test_suite.mjs", "WebRTC signaling, STUN NAT traversal & speech script audit suite", "javascript"),
    ("Backend Core & AI Engines", "backend/crosscheck_all.py", "Full-system integration cross-check script", "python"),
    ("Backend Core & AI Engines", "backend/test_production_suite.py", "Backend production test suite & video verification", "python"),
    ("Backend Core & AI Engines", "backend/api/index.js", "Vercel serverless entrypoint for backend", "javascript"),
    ("Backend Core & AI Engines", "backend/requirements.txt", "Backend Python dependencies", "text"),
    ("Backend Core & AI Engines", "backend/package.json", "Backend Node dependencies & scripts", "json"),
    ("Backend Core & AI Engines", "backend/Dockerfile", "Backend Docker container definition", "dockerfile"),
    ("Backend Core & AI Engines", "backend/vercel.json", "Backend deployment routing configuration", "json"),
    ("Backend Core & AI Engines", "backend/.env.example", "Backend environment variable blueprint (Dual Gemini Keys)", "text"),
    ("Backend Core & AI Engines", "main.py", "Root entrypoint application script", "python"),
    ("Backend Core & AI Engines", "test_e2e_pipeline.py", "End-to-end integration pipeline test", "python"),
    ("Backend Core & AI Engines", "requirements.txt", "Root Python dependencies", "text"),
    ("Backend Core & AI Engines", "Dockerfile", "Multi-stage project Dockerfile", "dockerfile"),
    ("Backend Core & AI Engines", "docker-compose.yml", "Local orchestration config", "yaml"),
    ("Backend Core & AI Engines", "render.yaml", "Render cloud deployment blueprint", "yaml"),
    ("Backend Core & AI Engines", ".env.example", "Root environment configuration blueprint", "text"),

    # ── 2. Cloud Functions & Infrastructure ─────────────────────────────────
    ("Cloud Functions & Infrastructure", "functions/index.js", "Firebase Cloud Functions (auth, meetings, analysis triggers & guardrails)", "javascript"),
    ("Cloud Functions & Infrastructure", "functions/package.json", "Cloud Functions dependencies", "json"),
    ("Cloud Functions & Infrastructure", "api/rooms.js", "Room management serverless API", "javascript"),
    ("Cloud Functions & Infrastructure", "firestore.rules", "Cloud Firestore security rules", "text"),
    ("Cloud Functions & Infrastructure", "storage.rules", "Firebase Storage security rules", "text"),
    ("Cloud Functions & Infrastructure", "firebase.json", "Firebase services & hosting configuration", "json"),
    ("Cloud Functions & Infrastructure", "firestore.indexes.json", "Firestore composite indexes", "json"),
    ("Cloud Functions & Infrastructure", "package.json", "Workspace root package configuration", "json"),

    # ── 3. Frontend Core Application ────────────────────────────────────────
    ("Frontend Application", "frontend/src/main.jsx", "React 19 client bootstrap & DOM mount", "javascript"),
    ("Frontend Application", "frontend/src/App.jsx", "Main App component, router, role entrance & auth context", "javascript"),
    ("Frontend Application", "frontend/src/MeetingRoom.jsx", "WebRTC conference room, multi-track mixer, HUD & active speaker", "javascript"),
    ("Frontend Application", "frontend/src/MeetingDashboard.jsx", "Communication scorecards, assertiveness & tone style metrics, history & PDF", "javascript"),
    ("Frontend Application", "frontend/src/PostMeetingDashboard.jsx", "Post-meeting AI debrief, recording download & script viewer", "javascript"),
    ("Frontend Application", "frontend/src/AnalysisReport.jsx", "Comprehensive report viewer & export interface", "javascript"),
    ("Frontend Application", "frontend/src/ErrorBoundary.jsx", "React UI crash error boundary", "javascript"),
    ("Frontend Application", "frontend/src/config.js", "Frontend environment, WebRTC optimizer & STUN API configuration", "javascript"),
    ("Frontend Application", "frontend/src/firebase.js", "Firebase Client SDK & live Dual Gemini pipeline caller", "javascript"),
    ("Frontend Application", "frontend/src/services/videoAnalysisService.js", "Client video streaming, multi-speaker payload & API caller", "javascript"),
    ("Frontend Application", "frontend/src/services/index.js", "Service exports index", "javascript"),
    ("Frontend Application", "frontend/src/utils/audioAnalyzer.js", "Web Audio API volume, pitch, FFT & speech analyzer", "javascript"),
    ("Frontend Application", "frontend/src/utils/recordingsDb.js", "IndexedDB client recording & session persistence", "javascript"),
    ("Frontend Application", "frontend/src/utils/exportPresentationPdf.js", "Presentation PDF export utility", "javascript"),

    # ── 4. Frontend Stylesheets ─────────────────────────────────────────────
    ("Frontend Styles", "frontend/src/index.css", "Global design system, dark theme & typography", "css"),
    ("Frontend Styles", "frontend/src/MeetingRoom.css", "Conference room, video grid & HUD controls styling", "css"),
    ("Frontend Styles", "frontend/src/MeetingDashboard.css", "Scorecards, metric bars, assertiveness & tone styling", "css"),
    ("Frontend Styles", "frontend/src/PostMeetingDashboard.css", "Post-meeting analytics layout & charts styling", "css"),
    ("Frontend Styles", "frontend/src/AnalysisReport.css", "Analysis report and PDF export layout styling", "css"),

    # ── 5. Frontend Config & Mobile ─────────────────────────────────────────
    ("Frontend Config & Mobile", "frontend/index.html", "Single Page Application root HTML", "html"),
    ("Frontend Config & Mobile", "frontend/vite.config.js", "Vite build tool configuration & plugins", "javascript"),
    ("Frontend Config & Mobile", "frontend/package.json", "Frontend dependencies & build scripts", "json"),
    ("Frontend Config & Mobile", "frontend/vercel.json", "Frontend SPA Vercel routing configuration", "json"),
    ("Frontend Config & Mobile", "frontend/capacitor.config.json", "Capacitor cross-platform mobile app config", "json"),
    ("Frontend Config & Mobile", "frontend/android/app/build.gradle", "Android App module Gradle dependencies & SDK config", "gradle"),
    ("Frontend Config & Mobile", "frontend/android/app/src/main/java/com/guardianeye/ai/MainActivity.java", "Capacitor Android bridge activity", "java"),
    ("Frontend Config & Mobile", "frontend/android/app/src/main/AndroidManifest.xml", "Android manifest & runtime permissions", "xml"),
]

def build_master_html():
    print("[*] Collecting source code across all project files...")
    toc_items = []
    file_sections = []
    total_lines = 0
    total_bytes = 0

    valid_files = [item for item in ALL_PROJECT_FILES if os.path.exists(item[1])]

    for category, path, desc, lang in valid_files:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            code_text = f.read()

        lines = code_text.splitlines()
        line_count = len(lines)
        total_lines += line_count
        size_bytes = os.path.getsize(path)
        total_bytes += size_bytes
        size_kb = size_bytes / 1024.0

        numbered_lines = []
        for idx, line in enumerate(lines, 1):
            escaped = html.escape(line)
            numbered_lines.append(f'<span class="ln">{idx:4d}</span> {escaped}')
        code_html = "\n".join(numbered_lines)

        file_id = len(toc_items) + 1
        toc_items.append({
            "id": f"file-{file_id}",
            "category": category,
            "path": path,
            "desc": desc,
            "lines": line_count,
            "size": f"{size_kb:.1f} KB",
            "lang": lang.upper()
        })

        file_sections.append(f'''
        <div class="code-file" id="file-{file_id}">
            <div class="file-header">
                <div class="file-title-box">
                    <span class="file-badge">{html.escape(lang.upper())}</span>
                    <span class="file-path">{html.escape(path)}</span>
                </div>
                <div class="file-meta">
                    <span>{line_count:,} lines</span> • <span>{size_kb:.1f} KB</span>
                </div>
            </div>
            <div class="file-desc">{html.escape(desc)}</div>
            <pre class="code-block"><code>{code_html}</code></pre>
        </div>
        ''')

    # Build TOC HTML grouped by category
    toc_html = []
    current_cat = None
    for item in toc_items:
        if item["category"] != current_cat:
            if current_cat is not None:
                toc_html.append('</div>')
            current_cat = item["category"]
            toc_html.append(f'<div class="toc-group"><h3>{html.escape(current_cat)}</h3>')

        toc_html.append(f'''
            <div class="toc-row">
                <a href="#{item["id"]}" class="toc-link">
                    <span class="toc-badge">{item["lang"]}</span>
                    <span class="toc-file">{html.escape(item["path"])}</span>
                </a>
                <span class="toc-desc">{html.escape(item["desc"])}</span>
                <span class="toc-stats">{item["lines"]:,} lines ({item["size"]})</span>
            </div>
        ''')
    if current_cat is not None:
        toc_html.append('</div>')

    toc_rendered = "\n".join(toc_html)
    files_rendered = "\n".join(file_sections)

    full_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Guardian Eye AI — Master Architecture, Data Flow, Algorithms, Workcases & Complete Source Code</title>
    <style>
        @page {{
            size: A4;
            margin: 12mm 10mm 12mm 10mm;
            @bottom-right {{
                content: counter(page);
                font-family: monospace;
                font-size: 8pt;
                color: #64748b;
            }}
        }}

        * {{
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #1e293b;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 10pt;
            line-height: 1.5;
        }}

        /* COVER PAGE */
        .cover-page {{
            page-break-after: always;
            height: 96vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 40px;
            background: linear-gradient(135deg, #090d16 0%, #0f172a 40%, #1e1b4b 100%);
            color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }}

        .cover-badge {{
            display: inline-block;
            background: rgba(99, 102, 241, 0.25);
            border: 1px solid #818cf8;
            color: #c7d2fe;
            padding: 6px 18px;
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 24px;
        }}

        .cover-title {{
            font-size: 34pt;
            font-weight: 900;
            letter-spacing: -1.5px;
            margin: 0 0 16px 0;
            background: linear-gradient(to right, #ffffff, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}

        .cover-subtitle {{
            font-size: 14pt;
            color: #94a3b8;
            max-width: 720px;
            margin: 0 0 36px 0;
            line-height: 1.5;
        }}

        .cover-meta {{
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            max-width: 760px;
            width: 100%;
            margin-top: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.15);
            padding-top: 24px;
        }}

        .meta-card {{
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 14px;
            border-radius: 8px;
        }}

        .meta-val {{
            font-size: 18pt;
            font-weight: 800;
            color: #38bdf8;
            margin-bottom: 4px;
        }}

        .meta-label {{
            font-size: 8.5pt;
            color: #cbd5e1;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}

        .cover-date {{
            margin-top: 40px;
            font-size: 9.5pt;
            color: #64748b;
        }}

        /* SECTION HEADERS */
        .section-break {{
            page-break-before: always;
            padding-top: 10px;
        }}

        .section-header {{
            background: linear-gradient(135deg, #0f172a, #1e293b);
            color: #ffffff;
            padding: 16px 20px;
            border-radius: 8px;
            margin-bottom: 24px;
            border-left: 6px solid #6366f1;
        }}

        .section-header h2 {{
            margin: 0;
            font-size: 17pt;
            font-weight: 800;
            letter-spacing: -0.5px;
        }}

        .section-header p {{
            margin: 4px 0 0 0;
            color: #94a3b8;
            font-size: 9.5pt;
        }}

        /* CONTENT CARDS */
        .content-card {{
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 16px;
            page-break-inside: avoid;
        }}

        .content-card.indigo {{ border-left: 4px solid #6366f1; }}
        .content-card.cyan {{ border-left: 4px solid #06b6d4; }}
        .content-card.emerald {{ border-left: 4px solid #10b981; }}
        .content-card.amber {{ border-left: 4px solid #f59e0b; }}
        .content-card.purple {{ border-left: 4px solid #8b5cf6; }}
        .content-card.rose {{ border-left: 4px solid #f43f5e; }}

        .card-title {{
            font-size: 12.5pt;
            font-weight: 700;
            color: #0f172a;
            margin: 0 0 8px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }}

        .card-num {{
            background: #e0e7ff;
            color: #4338ca;
            font-size: 9pt;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 4px;
        }}

        p {{
            margin: 0 0 8px 0;
            color: #334155;
            line-height: 1.6;
        }}

        p:last-child {{ margin-bottom: 0; }}

        .tech-pill {{
            background: #f1f5f9;
            color: #0f172a;
            border: 1px solid #cbd5e1;
            padding: 2px 7px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 8.5pt;
            font-weight: 600;
        }}

        .formula-box {{
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-left: 3px solid #0284c7;
            padding: 10px 14px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 9pt;
            color: #0369a1;
            margin: 10px 0;
        }}

        /* TABLES */
        table.spec-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 9pt;
            margin: 12px 0;
        }}

        table.spec-table th {{
            background: #0f172a;
            color: #ffffff;
            padding: 8px 12px;
            text-align: left;
            font-weight: 700;
            border: 1px solid #334155;
        }}

        table.spec-table td {{
            padding: 8px 12px;
            border: 1px solid #e2e8f0;
            color: #334155;
            vertical-align: top;
        }}

        table.spec-table tr:nth-child(even) {{
            background: #f8fafc;
        }}

        /* TOC */
        .toc-group {{
            margin-bottom: 20px;
            page-break-inside: avoid;
        }}

        .toc-group h3 {{
            font-size: 11.5pt;
            font-weight: 700;
            color: #3730a3;
            margin: 14px 0 6px 0;
            padding-bottom: 4px;
            border-bottom: 1px dashed #cbd5e1;
        }}

        .toc-row {{
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 9pt;
            border-bottom: 1px solid #f1f5f9;
        }}

        .toc-link {{
            text-decoration: none;
            color: #0284c7;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }}

        .toc-badge {{
            font-size: 7pt;
            background: #e0f2fe;
            color: #0369a1;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: sans-serif;
            font-weight: 700;
        }}

        .toc-desc {{
            color: #64748b;
            font-size: 8pt;
            margin: 0 12px;
            flex-grow: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }}

        .toc-stats {{
            color: #94a3b8;
            font-size: 8pt;
            flex-shrink: 0;
        }}

        /* CODE FILE STYLES */
        .code-file {{
            page-break-before: always;
            margin-bottom: 24px;
        }}

        .file-header {{
            background: #0f172a;
            color: #ffffff;
            padding: 10px 14px;
            border-radius: 6px 6px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #38bdf8;
        }}

        .file-title-box {{
            display: flex;
            align-items: center;
            gap: 10px;
        }}

        .file-badge {{
            background: #0284c7;
            color: #ffffff;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 7.5pt;
            font-weight: 800;
            letter-spacing: 0.5px;
        }}

        .file-path {{
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 9.5pt;
            font-weight: 700;
            color: #f8fafc;
        }}

        .file-meta {{
            font-size: 8pt;
            color: #94a3b8;
            font-family: sans-serif;
        }}

        .file-desc {{
            background: #f1f5f9;
            color: #475569;
            font-size: 8.5pt;
            padding: 6px 14px;
            border-left: 1px solid #e2e8f0;
            border-right: 1px solid #e2e8f0;
            font-style: italic;
        }}

        pre.code-block {{
            margin: 0;
            padding: 12px 14px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-top: none;
            border-radius: 0 0 6px 6px;
            overflow-x: hidden;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 7.8pt;
            line-height: 1.35;
            color: #0f172a;
            white-space: pre-wrap;
            word-break: break-all;
        }}

        .ln {{
            color: #94a3b8;
            user-select: none;
            display: inline-block;
            width: 3.2em;
            text-align: right;
            margin-right: 0.8em;
            border-right: 1px solid #cbd5e1;
            padding-right: 0.4em;
            font-weight: normal;
        }}
    </style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover-page">
    <div class="cover-badge">ENTERPRISE MULTIMODAL AI &amp; WEBRTC PLATFORM</div>
    <div class="cover-title">GUARDIAN EYE AI</div>
    <div class="cover-subtitle">Complete System Architecture, End-to-End Data Flow, Algorithms Specification, Dual-Key API Architecture, Workcases &amp; Master Project Source Code</div>
    
    <div class="cover-meta">
        <div class="meta-card">
            <div class="meta-val">{len(valid_files)}</div>
            <div class="meta-label">Total Files</div>
        </div>
        <div class="meta-card">
            <div class="meta-val">{total_lines:,}</div>
            <div class="meta-label">Lines of Code</div>
        </div>
        <div class="meta-card">
            <div class="meta-val">Gemini 2.5</div>
            <div class="meta-label">Native Multimodal AI</div>
        </div>
        <div class="meta-card">
            <div class="meta-val">Ports 5173 / 8000</div>
            <div class="meta-label">React + FastAPI</div>
        </div>
    </div>
    <div class="cover-date">Generated on November 2026 • Verified Production Master Document</div>
</div>

<!-- ========================================================================= -->
<!-- PART 1: SYSTEM OVERVIEW & ARCHITECTURAL LAYERS                            -->
<!-- ========================================================================= -->
<div class="section-break">
    <div class="section-header">
        <h2>PART 1: SYSTEM OVERVIEW &amp; 4-TIER ARCHITECTURAL STACK</h2>
        <p>Comprehensive description of Guardian Eye AI, operational design, and microservices topography</p>
    </div>

    <div class="content-card indigo">
        <div class="card-title"><span class="card-num">1.1</span> Product Concept &amp; Core Purpose</div>
        <p><strong>Guardian Eye AI</strong> is an enterprise-grade multimodal video conferencing, real-time communication intelligence, and automated conversation auditing platform. It addresses the critical business need for objective, verifiable, and bias-free communication evaluation across live conferences and recorded meetings.</p>
        <p>Unlike standard video calling solutions that simply transmit audio and video streams, Guardian Eye AI embeds a continuous acoustic and cognitive analytics engine. During a call, the system records multi-party audio using a browser-native multi-source audio mixer, extracts acoustic telemetry (Words Per Minute, filler words, hesitation pauses), performs 5-speaker voice diarization ("Who Spoke What"), executes strict 1–10 cognitive scoring, measures <strong>Persuasive Assertiveness</strong> and <strong>Tone Style Delivery Vectors</strong>, verifies Q&amp;A accuracy via an anti-hallucination fact-checking audit, and generates instant downloadable multi-page executive PDF reports.</p>
    </div>

    <div class="content-card cyan">
        <div class="card-title"><span class="card-num">1.2</span> 4-Tier Architectural Stack</div>
        <p>The system operates across four decoupled, high-performance layers:</p>
        <table class="spec-table">
            <tr>
                <th>Architectural Tier</th>
                <th>Port / Protocol</th>
                <th>Core Technologies</th>
                <th>Primary Responsibilities</th>
            </tr>
            <tr>
                <td><strong>1. Client Presentation Layer</strong></td>
                <td>Port 5173<br>(HTTP/HTTPS)</td>
                <td>React 19, Vite, Tailwind CSS, Lucide Icons, Web Audio API</td>
                <td>Webcam/mic acquisition with 4-stage progressive hardware fallback, HUD overlays, active speaker detection via 128-bin FFT, multi-stream audio mixing, dynamic scorecard charts.</td>
            </tr>
            <tr>
                <td><strong>2. Real-Time Signaling Layer</strong></td>
                <td>Port 9000<br>(WebSocket/TCP)</td>
                <td>Node.js Express, PeerJS Server</td>
                <td>Coordinates WebRTC SDP offer/answer exchanges, ICE candidate harvesting across 8 Google/Cloudflare STUN servers, knock-and-approve participant admission protocol, kick broadcasts.</td>
            </tr>
            <tr>
                <td><strong>3. Core AI &amp; Processing Layer</strong></td>
                <td>Port 8000<br>(FastAPI/ASGI)</td>
                <td>Python 3.10+, Uvicorn, FFmpeg, Google Gemini 2.5 Flash SDK</td>
                <td>Bcrypt user authentication, 16kHz PCM WAV extraction, 48kbps MP3 base64 encoding, native audio diarization, cognitive scoring heuristics, fact-checking audits.</td>
            </tr>
            <tr>
                <td><strong>4. Persistence &amp; Cache Layer</strong></td>
                <td>Local &amp; Cloud</td>
                <td>SQLite3 (guardianeye.db), IndexedDB, localStorage, Firebase</td>
                <td>Zero-plaintext Bcrypt credential hashing in SQLite, zero-cloud bandwidth browser recording storage in IndexedDB, offline report caching in localStorage, Firestore sync.</td>
            </tr>
        </table>
    </div>
</div>

<!-- ========================================================================= -->
<!-- PART 2: END-TO-END DATA FLOW & MEETING LIFECYCLE                         -->
<!-- ========================================================================= -->
<div class="section-break">
    <div class="section-header">
        <h2>PART 2: COMPREHENSIVE END-TO-END DATA FLOW &amp; LIFECYCLE</h2>
        <p>Step-by-step trace of packets, media streams, and API invocations from authentication to PDF export</p>
    </div>

    <div class="content-card emerald">
        <div class="card-title"><span class="card-num">2.1</span> The Complete 8-Stage Meeting Lifecycle</div>
        <p><strong>Stage 1 — Role Selection &amp; Authentication:</strong> The user accesses the landing portal (<span class="tech-pill">App.jsx</span>). A Host enters their Gmail address and password. The frontend validates the format via regex (<span class="tech-pill">/^[a-zA-Z0-9._%+-]+@gmail\.com$/i</span>) and dispatches a JSON POST to <span class="tech-pill">/api/auth/login</span>. The FastAPI backend hashes/checks the password using Bcrypt with 12 salt rounds against <span class="tech-pill">guardianeye.db</span> and issues an authorized session token. Participants simply enter a 6-character room code and display name.</p>
        
        <p><strong>Stage 2 — Room Creation &amp; Unambiguous Code Generation:</strong> When the Host clicks "Create New Meeting", the backend executes an unambiguous Base-32 sampling algorithm sampling 6 characters from <span class="tech-pill">ABCDEFGHJKLMNPQRSTUVWXYZ23456789</span> (excluding 0, O, 1, I) formatted as <span class="tech-pill">XXX-XXX</span>. The room is registered in SQLite and the PeerJS signaling broker.</p>

        <p><strong>Stage 3 — Knock-and-Approve Handshake Protocol:</strong> When a participant navigates to the room code, their browser calls <span class="tech-pill">GET /api/rooms/{{code}}</span> to discover the Host's active PeerJS ID. The guest opens a WebRTC DataChannel (<span class="tech-pill">reliable: true</span>) and transmits a <span class="tech-pill">{{ type: "knock", peerId, name }}</span> packet. The Host receives a floating UI notification with Accept and Reject actions. Once approved, the Host verifies room occupancy (&lt; 5 members) and broadcasts peer connection tokens.</p>

        <p><strong>Stage 4 — Full-Mesh WebRTC Call Negotiation:</strong> Each peer initiates peer-to-peer media streams with every other participant using SDP offer/answer handshakes. Session Description Protocol text is dynamically rewritten to prioritize hardware-accelerated H.264 and VP8 codecs with video bandwidth capped at 500 kbps (24 fps) and audio given unthrottled high-priority transport.</p>

        <p><strong>Stage 5 — Multi-Source Audio Mixer Recording:</strong> Clicking Record triggers screen capture paired with a custom Web Audio API multi-track audio mixer. The mixer combines the host's microphone, all incoming remote participant WebRTC audio tracks, and system tab sounds into a unified 48kHz audio stream fed to a <span class="tech-pill">MediaRecorder</span> encoding to WebM/MP4.</p>

        <p><strong>Stage 6 — FFmpeg Audio Extraction &amp; Preprocessing:</strong> The video recording (or uploaded video file) is dispatched to <span class="tech-pill">POST /api/meeting/analyze-video</span>. The backend invokes FFmpeg in a sandboxed subprocess to extract a pristine 16,000 Hz 16-bit mono PCM WAV file for acoustic analysis, alongside an optimized 48kbps MP3 stream under 15 MB for cloud transmission.</p>

        <p><strong>Stage 7 — Gemini 2.5 Flash Native Audio Diarization &amp; Scoring:</strong> The base64-encoded audio is fed directly into Google Gemini 2.5 Flash (<span class="tech-pill">inline_data: audio/mp3</span>) using <span class="tech-pill">GEMINI_API_KEY_PRIMARY</span>. Gemini analyzes the raw audio waveform, transcribes every turn verbatim, tags speakers using the exact entered participant names, evaluates pragmatic tone style, and grades persuasive assertiveness (1–10). A second prompt pass using <span class="tech-pill">GEMINI_API_KEY_SECONDARY</span> executes cognitive scoring rubrics and Q&amp;A fact-checking audits.</p>

        <p><strong>Stage 8 — Dashboard Rendering &amp; PDF Report Export:</strong> Results are displayed on <span class="tech-pill">MeetingDashboard.jsx</span> with animated progress bars, tone delivery badges, expandable chronological dialogues, and a 3-column Fact-Check table. Clicking "Download PDF Report" captures the UI via <span class="tech-pill">html2canvas</span> and cleanly splits it into standard multi-page A4 PDF sheets via <span class="tech-pill">jsPDF</span>.</p>
    </div>
</div>

<!-- ========================================================================= -->
<!-- PART 3: DETAILED ALGORITHMS SPECIFICATION                                -->
<!-- ========================================================================= -->
<div class="section-break">
    <div class="section-header">
        <h2>PART 3: ALGORITHMS SPECIFICATION (20 CORE ALGORITHMS)</h2>
        <p>Mathematical formulations, pseudocode representations, and implementation mechanics</p>
    </div>

    <!-- Algorithm 1 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-01</span> Bcrypt Adaptive Blowfish Password Hashing</div>
        <p><strong>Purpose:</strong> Cryptographically guarantees user authentication credentials against brute-force and rainbow table attacks.</p>
        <p><strong>Implementation:</strong> Located in <span class="tech-pill">backend/main.py</span>. Uses <span class="tech-pill">bcrypt.gensalt(rounds=12)</span> resulting in \(2^{{12}} = 4,096\) key expansion rounds. Plaintext passwords are never persisted. Registration executes <span class="tech-pill">bcrypt.hashpw(password.encode('utf-8'), salt)</span>. Login executes <span class="tech-pill">bcrypt.checkpw(entered_pw, stored_hash)</span>.</p>
    </div>

    <!-- Algorithm 2 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-02</span> Unambiguous Base-32 Alphanumeric Room Sampling</div>
        <p><strong>Purpose:</strong> Generates collision-resistant, human-legible meeting codes formatted as <span class="tech-pill">XXX-XXX</span>.</p>
        <p><strong>Alphabet:</strong> <span class="tech-pill">ABCDEFGHJKLMNPQRSTUVWXYZ23456789</span> (32 characters). Characters '0', 'O', '1', and 'I' are strictly excluded to avoid optical confusion between zeros and capital letters.</p>
        <div class="formula-box">Total Unique Combinations = 32^6 = 1,073,741,824 distinct meeting codes</div>
    </div>

    <!-- Algorithm 3 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-03</span> 4-Stage Progressive Hardware Media Fallback</div>
        <p><strong>Purpose:</strong> Guarantees camera and microphone initialization across diverse hardware and permission constraints.</p>
        <p><strong>Stages in <span class="tech-pill">MeetingRoom.jsx</span>:</strong><br>
        • <em>Stage 1 (HD + DSP):</em> <span class="tech-pill">{{ video: {{ width: 1280, height: 720, frameRate: 30 }}, audio: {{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }} }}</span><br>
        • <em>Stage 2 (Standard):</em> Falls back to <span class="tech-pill">{{ video: true, audio: true }}</span> if HD constraints fail.<br>
        • <em>Stage 3 (Video Only):</em> Falls back to <span class="tech-pill">{{ video: true, audio: false }}</span> if microphone is locked by OS.<br>
        • <em>Stage 4 (Audio Only):</em> Falls back to <span class="tech-pill">{{ video: false, audio: true }}</span> for headless devices.</p>
    </div>

    <!-- Algorithm 4 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-04</span> WebRTC DataChannel Knock-and-Approve Handshake</div>
        <p><strong>Purpose:</strong> Prevents unauthorized intruders from entering meeting rooms without explicit host consent.</p>
        <p><strong>Protocol:</strong> Participant opens DataChannel to Host Peer ID &rarr; sends <span class="tech-pill">{{ type: "knock", peerId, name }}</span> &rarr; Host reviews queue &rarr; on Accept, Host checks room size &lt; 5 &rarr; replies <span class="tech-pill">{{ type: "knock_approved", existingPeers: [...] }}</span> &rarr; broadcasts <span class="tech-pill">{{ type: "participant_joined" }}</span> &rarr; initiates WebRTC media mesh call.</p>
    </div>

    <!-- Algorithm 5 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-05</span> Full-Mesh P2P Topology &amp; 8-Server STUN NAT Traversal</div>
        <p><strong>Purpose:</strong> Establishes direct low-latency UDP streams between up to 5 browsers without an expensive media server.</p>
        <p><strong>Servers:</strong> Redundant array of 8 STUN servers (Google <span class="tech-pill">stun.l.google.com:19302</span>, Cloudflare <span class="tech-pill">stun.cloudflare.com:3478</span>, Mozilla <span class="tech-pill">stun.services.mozilla.com</span>). ICE candidate gathering mode is set to aggressive trickle candidate exchange.</p>
    </div>

    <!-- Algorithm 6 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-06</span> SDP Codec Prioritization &amp; Dynamic Bitrate Throttling</div>
        <p><strong>Purpose:</strong> Enforces low CPU consumption and eliminates audio stuttering on congested networks.</p>
        <p><strong>Mechanics:</strong> Modifies the SDP text during WebRTC offer generation by shifting H.264 and VP8 codec IDs to the top of the <span class="tech-pill">m=video</span> payload array. Caps video track bitrate at 500 kbps (24 fps max) while granting unconstrained bandwidth to Opus audio.</p>
    </div>

    <!-- Algorithm 7 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-07</span> Web Audio API 128-Bin FFT Active Speaker Detection</div>
        <p><strong>Purpose:</strong> Identifies and highlights the current speaker in real time with zero server overhead.</p>
        <p><strong>Execution:</strong> In <span class="tech-pill">MeetingRoom.jsx</span>, every audio stream connects to an <span class="tech-pill">AudioContext.createAnalyser()</span> with <span class="tech-pill">fftSize = 256</span> (128 discrete frequency bins). Every 100ms, <span class="tech-pill">getByteFrequencyData()</span> calculates root-mean-square energy. The participant exceeding the dynamic noise floor with the highest energy is crowned active speaker.</p>
    </div>

    <!-- Algorithm 8 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-08</span> Multi-Source Web Audio API Recording Mixer</div>
        <p><strong>Purpose:</strong> Overcomes browser limitation where screen capture only records a single audio track.</p>
        <p><strong>Acoustic Graph:</strong> An <span class="tech-pill">AudioContext</span> instances a <span class="tech-pill">ChannelMergerNode</span> and <span class="tech-pill">MediaStreamAudioDestinationNode</span>. Inputs include: (1) Host local microphone, (2) all remote peer audio tracks, (3) display media tab audio. All inputs are blended and output as a single synchronized audio track for <span class="tech-pill">MediaRecorder</span>.</p>
    </div>

    <!-- Algorithm 9 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-09</span> FFmpeg Dual-Format Audio Extraction</div>
        <p><strong>Purpose:</strong> Produces mathematically pure WAV audio for local DSP and lightweight MP3 for fast AI cloud ingestion.</p>
        <div class="formula-box">ffmpeg -i &lt;input&gt; -vn -acodec pcm_s16le -ar 16000 -ac 1 audio.wav<br>ffmpeg -i audio.wav -codec:a libmp3lame -b:a 48k audio.mp3</div>
    </div>

    <!-- Algorithm 10 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-10</span> Voice Activity Detection (VAD) Energy Windowing</div>
        <p><strong>Purpose:</strong> Isolates true human speech segments from background acoustic silence.</p>
        <p><strong>Mechanics:</strong> Processes audio in 50ms sliding frames. Calculates Root Mean Square (RMS) energy: \(E = \sqrt{{\frac{{1}}{{N}}\sum x[i]^2}}\). Frames with energy above an adaptive threshold (\(E &gt; \text{{noise\_floor}} \times 1.8\)) are marked as active speech, with a 300ms hangover window to avoid clipping word endings.</p>
    </div>

    <!-- Algorithm 11 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-11</span> 6-Dimensional Acoustic Voiceprint Clustering</div>
        <p><strong>Purpose:</strong> Mathematically clusters distinct speaker segments prior to neural diarization.</p>
        <p><strong>Feature Vector:</strong> Each speech slice computes 6 acoustic dimensions:<br>
        1. <strong>F0 Fundamental Pitch:</strong> Harmonic frequency via autocorrelation.<br>
        2. <strong>Spectral Centroid:</strong> Center of mass of the spectrum (vocal brightness).<br>
        3. <strong>Spectral Bandwidth:</strong> Width of spectral distribution.<br>
        4. <strong>Spectral Rolloff:</strong> Frequency below which 85% of spectral energy resides.<br>
        5. <strong>Zero-Crossing Rate (ZCR):</strong> Rate of signal sign changes (fricatives/voicing).<br>
        6. <strong>Energy Envelope:</strong> Dynamic signal amplitude.</p>
    </div>

    <!-- Algorithm 12 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-12</span> Dual-Key Gemini 2.5 Flash Native Multimodal Audio Diarization</div>
        <p><strong>Purpose:</strong> Produces chronological "Who Spoke What" transcripts mapped to exact participant names with zero Groq dependency.</p>
        <p><strong>Pipeline:</strong> Encodes the 48kbps MP3 into base64. Submits to Google Gemini 2.5 Flash with primary API key. Gemini ingests the raw audio waveform, detects vocal pitch shifts and turn-taking, transcribes verbatim words (including fillers), and maps speakers directly to the roster: <span class="tech-pill">[Host, Guest 1, Guest 2, ...]</span>.</p>
    </div>

    <!-- Algorithm 13 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-13</span> Mathematical Guardrails &amp; Anti-Hallucination Clamping</div>
        <p><strong>Purpose:</strong> Prevents AI models from assigning arbitrary high scores to silent or minimal-speech participants.</p>
        <p><strong>Guardrail Rules:</strong><br>
        • If words spoken &lt; 4 (or characters &lt; 20): All scores clamped to 1.0/10 with rationale: <em>"Insufficient text spoken"</em>.<br>
        • If words spoken &lt; 15: Maximum score capped at 5.0/10.<br>
        • High filler rate (&gt; 6%): Caps Fluency at 6.0/10, enforces Awkwardness &ge; 4.0/10.<br>
        • Long hesitation pause (&gt; 4.0s): Limits Confidence to max 6.0/10.</p>
    </div>

    <!-- Algorithm 14 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-14</span> Persuasive Assertiveness Metric Algorithm (1–10)</div>
        <p><strong>Purpose:</strong> Evaluates rhetorical authority, conviction, and decisive speech posture.</p>
        <p><strong>Scoring Mechanics:</strong> High scores (8–10) require declarative framing, actionable recommendations, absence of apologetic qualifiers ("sorry to bother", "just thinking"), and steady pacing (125–150 WPM). Mid-range (5–7) indicates moderate conviction with occasional hedging. Low scores (1–4) reflect excessive deference or hesitation.</p>
    </div>

    <!-- Algorithm 15 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-15</span> Tone Style &amp; Delivery Vector Classification</div>
        <p><strong>Purpose:</strong> Categorizes the pragmatic communicative intent of each speaker into one of 4 vectors:</p>
        <p>• <strong>Commanding:</strong> Directive language, structured instructions, goal delegation.<br>
        • <strong>Requesting:</strong> Inquisitive structure, clarification seeking, requirement gathering.<br>
        • <strong>Polite:</strong> Deferential markers, courteous framing, constructive phrasing.<br>
        • <strong>Collaborative:</strong> Inclusive syntax ("we", "team", "let's"), synthesis, consensus-building.</p>
    </div>

    <!-- Algorithm 16 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-16</span> Executive Weighted Communication Index Formula</div>
        <p><strong>Purpose:</strong> Synthesizes individual metric ratings into a single defensible composite score.</p>
        <div class="formula-box">Executive Score = 0.25*(Skills) + 0.25*(Fluency) + 0.20*(Confidence) + 0.20*(Straightforward) + 0.10*(11 - Awkwardness)</div>
        <p><em>Note: Awkwardness is inverted (\(11 - \text{{Awkwardness}}\)) so lower awkwardness positively contributes to overall competence.</em></p>
    </div>

    <!-- Algorithm 17 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-17</span> Question-and-Answer (Q&amp;A) Fact-Checking Audit Engine</div>
        <p><strong>Purpose:</strong> Audits accountability by verifying whether participants directly answer questions posed to them.</p>
        <p><strong>Classification Triad:</strong><br>
        • <strong>Accurate:</strong> Responder provides verifiable, direct, concrete data addressing the question.<br>
        • <strong>Incomplete:</strong> Response is vague, omits critical details, or is interrupted mid-sentence.<br>
        • <strong>Evasive:</strong> Responder deflects, uses hedging phrases ("hard to say", "not my call"), or pivots away.</p>
    </div>

    <!-- Algorithm 18 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-18</span> 100% Browser-Native Web Audio Fallback Engine</div>
        <p><strong>Purpose:</strong> Guarantees application resilience if the backend server or internet is completely severed.</p>
        <p><strong>Mechanics:</strong> Located in <span class="tech-pill">audioAnalyzer.js</span>. Decodes the audio file directly into memory using <span class="tech-pill">AudioContext.decodeAudioData()</span>, computes speech energy slices, detects voice active turn intervals, and renders local client-side metric scorecards without throwing errors.</p>
    </div>

    <!-- Algorithm 19 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-19</span> Apple Silicon GPU (MPS) Local Diarization Acceleration</div>
        <p><strong>Purpose:</strong> Leverages Apple M1/M2/M3 Metal Performance Shaders for zero-cloud local execution.</p>
        <p><strong>Execution:</strong> Detects Apple Silicon and binds PyTorch to <span class="tech-pill">torch.device('mps')</span>. Executes local PyAnnote neural audio diarization pipelines at 5x real-time speed.</p>
    </div>

    <!-- Algorithm 20 -->
    <div class="content-card purple">
        <div class="card-title"><span class="card-num">ALG-20</span> Multi-Page PDF Segmentation &amp; Export Engine</div>
        <p><strong>Purpose:</strong> Generates crisp, paginated executive PDF documents with zero page-cut artifacts.</p>
        <p><strong>Mechanics:</strong> In <span class="tech-pill">MeetingDashboard.jsx</span>, renders the DOM at Retina scale (scale: 2) using <span class="tech-pill">html2canvas</span>, calculates pixel height offsets, and feeds page slices to <span class="tech-pill">jsPDF</span> at standard A4 dimensions (210mm x 297mm).</p>
    </div>
</div>

<!-- ========================================================================= -->
<!-- PART 4: DUAL-KEY API ARCHITECTURE & SECURITY                              -->
<!-- ========================================================================= -->
<div class="section-break">
    <div class="section-header">
        <h2>PART 4: DUAL GEMINI API ARCHITECTURE &amp; LOAD SPLITTING</h2>
        <p>Dual-key configuration, quota isolation, acquisition guide, and security boundaries</p>
    </div>

    <div class="content-card amber">
        <div class="card-title"><span class="card-num">4.1</span> Dual-Key Work Splitting Rationale</div>
        <p>High-volume audio processing and multi-speaker scoring can saturate Google AI Studio rate limits (RPM and TPM) if routed through a single API key. Guardian Eye AI implements an intelligent dual-key split architecture defined in <span class="tech-pill">backend/.env</span>:</p>
        <table class="spec-table">
            <tr>
                <th>Environment Variable</th>
                <th>Dedicated Workload</th>
                <th>Model Target</th>
                <th>Payload Size</th>
            </tr>
            <tr>
                <td><span class="tech-pill">GEMINI_API_KEY_PRIMARY</span></td>
                <td>Heavy Multimodal Audio Ingestion, 5-Speaker Diarization &amp; Verbatim Speech-to-Text</td>
                <td><span class="tech-pill">gemini-2.5-flash</span> (with cascade to gemini-3.5/3.8)</td>
                <td>Up to 15 MB base64 inline audio data per call</td>
            </tr>
            <tr>
                <td><span class="tech-pill">GEMINI_API_KEY_SECONDARY</span></td>
                <td>Cognitive 1–10 Metric Scoring, Tone &amp; Assertiveness Evaluation, Q&amp;A Fact-Checking</td>
                <td><span class="tech-pill">gemini-2.5-flash</span> (with cascade to gemini-3.5/3.8)</td>
                <td>Structured dialogue JSON &amp; telemetry arrays</td>
            </tr>
        </table>
        <p><strong>Automatic Failover:</strong> If either primary or secondary key experiences an HTTP 429 (quota exceeded) or HTTP 503 (demand spike), the system automatically attempts fallback to the alternate key and <span class="tech-pill">GEMINI_API_KEY</span>, ensuring zero user-facing downtime.</p>
    </div>

    <div class="content-card amber">
        <div class="card-title"><span class="card-num">4.2</span> API Key Acquisition &amp; Server-Side Protection</div>
        <p>Both keys are acquired free from <strong>Google AI Studio</strong> (<span class="tech-pill">https://aistudio.google.com/</span>) under separate Google Cloud projects for independent quota pools.</p>
        <p><strong>Zero Client-Side Exposure:</strong> The frontend client never has access to the Gemini API keys. All audio bytes and transcription requests are brokered strictly through the FastAPI backend (<span class="tech-pill">/api/meeting/analyze-video</span>). Keys remain strictly inside <span class="tech-pill">backend/.env</span> on the host server.</p>
    </div>
</div>

<!-- ========================================================================= -->
<!-- PART 5: WORKCASES & REAL-WORLD USE CASES                                 -->
<!-- ========================================================================= -->
<div class="section-break">
    <div class="section-header">
        <h2>PART 5: REAL-WORLD WORKCASES &amp; PRODUCTION SCENARIOS</h2>
        <p>Practical deployment environments, operational benefits, and concrete evaluation scenarios</p>
    </div>

    <div class="content-card rose">
        <div class="card-title"><span class="card-num">5.1</span> Workcase 1: Corporate Executive Boardrooms &amp; Strategy Syncs</div>
        <p><strong>Scenario:</strong> Executive leadership and department heads conduct weekly strategy syncs to review milestones and budget allocations.</p>
        <p><strong>Operational Value:</strong> The platform audits whether department heads give straightforward answers or evade tough budgetary inquiries. Tone Style vectors highlight whether managers are overly demanding (Commanding) or consensus-seeking (Collaborative). Persuasive Assertiveness reveals leadership impact.</p>
    </div>

    <div class="content-card rose">
        <div class="card-title"><span class="card-num">5.2</span> Workcase 2: Technical &amp; Behavioral HR Job Interviews</div>
        <p><strong>Scenario:</strong> Interviewers evaluate candidates across technical competencies and interpersonal skills.</p>
        <p><strong>Operational Value:</strong> Replaces subjective interviewer bias with verified mathematical telemetry. Measures true candidate fluency, counts filler words ("um", "like"), detects awkward hesitations, and verifies whether the candidate factually answered technical questions or pivoted to unrelated topics.</p>
    </div>

    <div class="content-card rose">
        <div class="card-title"><span class="card-num">5.3</span> Workcase 3: Academic Viva &amp; Thesis Defense</div>
        <p><strong>Scenario:</strong> University examiners evaluate graduate students defending their engineering or doctoral theses.</p>
        <p><strong>Operational Value:</strong> Generates an objective, defensible communication scorecard. Verifies student confidence, clarity of explanation, straightforwardness when answering examiners' cross-questions, and provides an instantly archivable PDF audit trail.</p>
    </div>

    <div class="content-card rose">
        <div class="card-title"><span class="card-num">5.4</span> Workcase 4: High-Stakes Enterprise Sales Pitches</div>
        <p><strong>Scenario:</strong> Sales engineers pitch enterprise software solutions to corporate client procurement teams.</p>
        <p><strong>Operational Value:</strong> The Persuasive Assertiveness metric evaluates whether sales reps deliver value propositions with commanding authority or tentative hedging. The Fact-Checking audit flags any incomplete answers given to prospective clients' security and pricing questions.</p>
    </div>

    <div class="content-card rose">
        <div class="card-title"><span class="card-num">5.5</span> Workcase 5: Distributed Engineering Standups</div>
        <p><strong>Scenario:</strong> Agile software development teams run daily 15-minute standup meetings across remote time zones.</p>
        <p><strong>Operational Value:</strong> WebRTC mesh connectivity connects up to 5 engineers with high-definition audio and video. Built-in active speaker detection highlights speaking engineers. The AI generates automated chronological action items and executive debriefs.</p>
    </div>

    <div class="content-card rose">
        <div class="card-title"><span class="card-num">5.6</span> Workcase 6: Legal &amp; Compliance Depositions</div>
        <p><strong>Scenario:</strong> Compliance officers and legal counsel conduct investigatory interviews and witness depositions.</p>
        <p><strong>Operational Value:</strong> Verbatim dialogue transcription captures every spoken nuance. The 3-tier Q&amp;A Fact-Checking engine explicitly flags "Evasive" and "Incomplete" responses for follow-up cross-examination.</p>
    </div>
</div>

<!-- ========================================================================= -->
<!-- PART 6: MASTER TABLE OF CONTENTS OF THE FULL CODEBASE                     -->
<!-- ========================================================================= -->
<div class="section-break">
    <div class="section-header">
        <h2>PART 6: MASTER CODEBASE TABLE OF CONTENTS (57 PRODUCTION FILES)</h2>
        <p>Complete categorized directory of all project source files with line counts, file sizes, and descriptions</p>
    </div>

    <div class="toc-page">
        {toc_rendered}
    </div>
</div>

<!-- ========================================================================= -->
<!-- PART 7: COMPLETE PROJECT SOURCE CODE                                     -->
<!-- ========================================================================= -->
<div class="section-break">
    <div class="section-header">
        <h2>PART 7: COMPLETE PROJECT SOURCE CODE (EVERY FILE IN FULL)</h2>
        <p>Full production source files with syntax numbering, language badges, and complete implementations</p>
    </div>

    {files_rendered}
</div>

</body>
</html>
'''

    output_html = "Guardian_Eye_AI_Complete_Project_Master.html"
    print(f"[*] Writing Master HTML to {output_html}...")
    with open(output_html, "w", encoding="utf-8") as f:
        f.write(full_html)
    size_mb = os.path.getsize(output_html) / (1024.0 * 1024.0)
    print(f"[✓] Wrote {output_html} ({len(valid_files)} files, {total_lines:,} lines, {size_mb:.2f} MB)")

    chrome_bin = find_chrome()
    if not chrome_bin:
        print("[!] ERROR: Google Chrome / Chromium binary not found.")
        return

    output_pdf = "Guardian_Eye_AI_Complete_Project_Master.pdf"
    public_pdf = "frontend/public/Guardian_Eye_AI_Complete_Project_Master.pdf"

    temp_profile = f"/tmp/chrome-pdf-{os.getpid()}"
    os.makedirs(temp_profile, exist_ok=True)

    print(f"[*] Converting HTML to PDF via Chrome Headless ({chrome_bin})...")
    start_t = time.time()
    cmd = [
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-crash-reporter",
        "--crash-dumps-dir=/tmp",
        f"--user-data-dir={temp_profile}",
        "--no-pdf-header-footer",
        f"--print-to-pdf={os.path.abspath(output_pdf)}",
        os.path.abspath(output_html)
    ]
    subprocess.run(cmd, check=True)
    duration = time.time() - start_t
    pdf_size_mb = os.path.getsize(output_pdf) / (1024.0 * 1024.0)
    print(f"[✓] Generated Master PDF: {output_pdf} ({pdf_size_mb:.2f} MB) in {duration:.1f}s")

    # Copy to frontend/public for instant browser download
    os.makedirs(os.path.dirname(public_pdf), exist_ok=True)
    shutil.copyfile(output_pdf, public_pdf)
    print(f"[✓] Copied to {public_pdf}")
    print(f"[✓] Direct download URL: http://localhost:5173/Guardian_Eye_AI_Complete_Project_Master.pdf")

if __name__ == "__main__":
    build_master_html()
