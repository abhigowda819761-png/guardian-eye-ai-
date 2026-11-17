import os
import html
import subprocess
import sys
import shutil

# Master list of all production source files organized by architectural layer
ALL_FILES = [
    # ── 1. Backend Core & AI Engines ─────────────────────────────────────────
    ("Backend Core & AI Engines", "backend/main.py", "FastAPI Core Server & WebSocket real-time AI endpoints", "python"),
    ("Backend Core & AI Engines", "backend/diarizer.py", "Speaker diarization and audio segmentation engine", "python"),
    ("Backend Core & AI Engines", "backend/speech_analytics.py", "Speech analytics, sentiment & vocal metrics", "python"),
    ("Backend Core & AI Engines", "backend/video_analysis_pipeline.py", "FFmpeg extraction, Groq Whisper & Gemini 2.5 Flash scoring pipeline", "python"),
    ("Backend Core & AI Engines", "backend/audio_extractor.py", "Acoustic audio extraction, prosody & ffmpeg preprocessing", "python"),
    ("Backend Core & AI Engines", "backend/communication_coach_prompt.py", "Gemini AI system prompts & coaching heuristics", "python"),
    ("Backend Core & AI Engines", "backend/peer_server.js", "WebRTC PeerJS signaling server & room manager", "javascript"),
    ("Backend Core & AI Engines", "backend/simulation_test_suite.mjs", "WebRTC signaling, STUN NAT traversal & speech script audit suite", "javascript"),
    ("Backend Core & AI Engines", "backend/crosscheck_all.py", "Full-system integration cross-check script", "python"),
    ("Backend Core & AI Engines", "backend/test_production_suite.py", "Backend production test suite & video verification", "python"),
    ("Backend Core & AI Engines", "backend/api/index.js", "Vercel serverless entrypoint for backend", "javascript"),
    ("Backend Core & AI Engines", "backend/requirements.txt", "Backend Python dependencies", "text"),
    ("Backend Core & AI Engines", "backend/package.json", "Backend Node dependencies & scripts", "json"),
    ("Backend Core & AI Engines", "backend/Dockerfile", "Backend Docker container definition", "dockerfile"),
    ("Backend Core & AI Engines", "backend/vercel.json", "Backend deployment routing configuration", "json"),
    ("Backend Core & AI Engines", "backend/.env.example", "Backend environment variable blueprint", "text"),
    ("Backend Core & AI Engines", "main.py", "Root entrypoint application script", "python"),
    ("Backend Core & AI Engines", "test_e2e_pipeline.py", "End-to-end integration pipeline test", "python"),
    ("Backend Core & AI Engines", "requirements.txt", "Root Python dependencies", "text"),
    ("Backend Core & AI Engines", "Dockerfile", "Multi-stage project Dockerfile", "dockerfile"),
    ("Backend Core & AI Engines", "docker-compose.yml", "Local orchestration config", "yaml"),
    ("Backend Core & AI Engines", "render.yaml", "Render cloud deployment blueprint", "yaml"),
    ("Backend Core & AI Engines", ".env.example", "Root environment configuration blueprint", "text"),

    # ── 2. Cloud Functions & Infrastructure ─────────────────────────────────
    ("Cloud Functions & Infrastructure", "functions/index.js", "Firebase Cloud Functions (auth, meetings, analysis triggers)", "javascript"),
    ("Cloud Functions & Infrastructure", "functions/package.json", "Cloud Functions dependencies", "json"),
    ("Cloud Functions & Infrastructure", "api/rooms.js", "Room management serverless API", "javascript"),
    ("Cloud Functions & Infrastructure", "firestore.rules", "Cloud Firestore security rules", "text"),
    ("Cloud Functions & Infrastructure", "storage.rules", "Firebase Storage security rules", "text"),
    ("Cloud Functions & Infrastructure", "firebase.json", "Firebase services & hosting configuration", "json"),
    ("Cloud Functions & Infrastructure", "firestore.indexes.json", "Firestore composite indexes", "json"),
    ("Cloud Functions & Infrastructure", "package.json", "Workspace root package configuration", "json"),

    # ── 3. Frontend Core Application ────────────────────────────────────────
    ("Frontend Application", "frontend/src/main.jsx", "React client bootstrap & DOM mount", "javascript"),
    ("Frontend Application", "frontend/src/App.jsx", "Main App component, router & auth context", "javascript"),
    ("Frontend Application", "frontend/src/MeetingRoom.jsx", "WebRTC real-time conference room & AI overlay HUD", "javascript"),
    ("Frontend Application", "frontend/src/MeetingDashboard.jsx", "Meetings management, scheduler & history view", "javascript"),
    ("Frontend Application", "frontend/src/PostMeetingDashboard.jsx", "Post-meeting AI debrief, recording download & script viewer", "javascript"),
    ("Frontend Application", "frontend/src/AnalysisReport.jsx", "Comprehensive report viewer & export interface", "javascript"),
    ("Frontend Application", "frontend/src/ErrorBoundary.jsx", "React UI crash error boundary", "javascript"),
    ("Frontend Application", "frontend/src/config.js", "Frontend environment, WebRTC optimizer & API configuration", "javascript"),
    ("Frontend Application", "frontend/src/firebase.js", "Firebase Client SDK & live Groq/Gemini pipeline caller", "javascript"),
    ("Frontend Application", "frontend/src/services/videoAnalysisService.js", "Client video streaming & frame capture service", "javascript"),
    ("Frontend Application", "frontend/src/services/index.js", "Service exports index", "javascript"),
    ("Frontend Application", "frontend/src/utils/audioAnalyzer.js", "Web Audio API volume, pitch & speech analyzer", "javascript"),
    ("Frontend Application", "frontend/src/utils/recordingsDb.js", "IndexedDB client recording & session persistence", "javascript"),

    # ── 4. Frontend Stylesheets ─────────────────────────────────────────────
    ("Frontend Styles", "frontend/src/index.css", "Global design system, themes & typography", "css"),
    ("Frontend Styles", "frontend/src/MeetingRoom.css", "Conference room, video grid & HUD controls styling", "css"),
    ("Frontend Styles", "frontend/src/MeetingDashboard.css", "Dashboard, meeting cards & statistics styling", "css"),
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

def generate_html(files_subset, doc_title, subtitle):
    toc_items = []
    file_sections = []
    total_lines = 0
    total_bytes = 0

    valid_files = [item for item in files_subset if os.path.exists(item[1])]

    for category, path, desc, lang in valid_files:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            code_text = f.read()

        lines = code_text.splitlines()
        line_count = len(lines)
        total_lines += line_count
        size_bytes = os.path.getsize(path)
        total_bytes += size_bytes
        size_kb = size_bytes / 1024.0

        # Number lines with HTML escaping
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

    full_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{html.escape(doc_title)}</title>
    <style>
        @page {{
            size: A4;
            margin: 14mm 12mm 14mm 12mm;
            @bottom-right {{
                content: counter(page);
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
            font-size: 11pt;
            line-height: 1.5;
        }}

        /* COVER PAGE */
        .cover-page {{
            page-break-after: always;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 40px;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            color: #ffffff;
            border-radius: 8px;
        }}

        .cover-badge {{
            display: inline-block;
            background: rgba(99, 102, 241, 0.25);
            border: 1px solid #818cf8;
            color: #c7d2fe;
            padding: 6px 16px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin-bottom: 24px;
        }}

        .cover-title {{
            font-size: 36pt;
            font-weight: 800;
            letter-spacing: -1px;
            margin: 0 0 16px 0;
            background: linear-gradient(to right, #ffffff, #a5b4fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}

        .cover-subtitle {{
            font-size: 15pt;
            color: #94a3b8;
            max-width: 680px;
            margin: 0 0 36px 0;
            line-height: 1.4;
        }}

        .cover-meta {{
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            max-width: 700px;
            width: 100%;
            margin-top: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.15);
            padding-top: 30px;
        }}

        .meta-card {{
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 16px;
            border-radius: 8px;
        }}

        .meta-val {{
            font-size: 20pt;
            font-weight: 700;
            color: #38bdf8;
            margin-bottom: 4px;
        }}

        .meta-label {{
            font-size: 10pt;
            color: #cbd5e1;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}

        .cover-date {{
            margin-top: 50px;
            font-size: 10pt;
            color: #64748b;
        }}

        /* TABLE OF CONTENTS */
        .toc-page {{
            page-break-after: always;
            padding-top: 10px;
        }}

        .section-title {{
            font-size: 20pt;
            font-weight: 800;
            color: #0f172a;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 8px;
            margin-bottom: 20px;
        }}

        .toc-group {{
            margin-bottom: 24px;
        }}

        .toc-group h3 {{
            font-size: 13pt;
            font-weight: 700;
            color: #3730a3;
            margin: 16px 0 8px 0;
            padding-bottom: 4px;
            border-bottom: 1px dashed #cbd5e1;
        }}

        .toc-row {{
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 9.5pt;
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
            font-size: 7.5pt;
            background: #e0f2fe;
            color: #0369a1;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: sans-serif;
            font-weight: 700;
        }}

        .toc-desc {{
            color: #64748b;
            font-size: 8.5pt;
            margin: 0 12px;
            flex-grow: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }}

        .toc-stats {{
            color: #94a3b8;
            font-size: 8.5pt;
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
        }}

        .file-title-box {{
            display: flex;
            align-items: center;
            gap: 10px;
        }}

        .file-badge {{
            background: #3b82f6;
            color: #ffffff;
            font-size: 8pt;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            letter-spacing: 0.5px;
        }}

        .file-path {{
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11pt;
            font-weight: 700;
            color: #f8fafc;
        }}

        .file-meta {{
            font-size: 9pt;
            color: #94a3b8;
        }}

        .file-desc {{
            background: #f8fafc;
            border-left: 1px solid #cbd5e1;
            border-right: 1px solid #cbd5e1;
            padding: 6px 14px;
            font-size: 9pt;
            color: #475569;
            font-style: italic;
        }}

        .code-block {{
            margin: 0;
            padding: 12px;
            background: #fdfdfd;
            border: 1px solid #cbd5e1;
            border-top: none;
            border-radius: 0 0 6px 6px;
            overflow-x: auto;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 8pt;
            line-height: 1.42;
            color: #0f172a;
            white-space: pre-wrap;
            word-break: break-all;
        }}

        .ln {{
            display: inline-block;
            width: 34px;
            color: #94a3b8;
            user-select: none;
            text-align: right;
            padding-right: 10px;
            border-right: 1px solid #e2e8f0;
            margin-right: 8px;
        }}
    </style>
</head>
<body>

    <!-- COVER PAGE -->
    <div class="cover-page">
        <span class="cover-badge">Complete Architectural Documentation</span>
        <h1 class="cover-title">{html.escape(doc_title)}</h1>
        <p class="cover-subtitle">{html.escape(subtitle)}</p>

        <div class="cover-meta">
            <div class="meta-card">
                <div class="meta-val">{len(valid_files)}</div>
                <div class="meta-label">Source Files</div>
            </div>
            <div class="meta-card">
                <div class="meta-val">{total_lines:,}</div>
                <div class="meta-label">Total Code Lines</div>
            </div>
            <div class="meta-card">
                <div class="meta-val">{(total_bytes / (1024 * 1024)):.2f} MB</div>
                <div class="meta-label">Codebase Volume</div>
            </div>
        </div>

        <div class="cover-date">
            Generated: October 2026 • GuardianEye AI Production Source • All Rights Reserved
        </div>
    </div>

    <!-- TABLE OF CONTENTS -->
    <div class="toc-page">
        <h2 class="section-title">Table of Contents & Component Directory</h2>
        {"".join(toc_html)}
    </div>

    <!-- CODE SECTIONS -->
    {"".join(file_sections)}

</body>
</html>
'''
    return full_html, len(valid_files), total_lines, total_bytes

def convert_html_to_pdf(html_path, pdf_path):
    chrome_bins = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser")
    ]
    chrome_bin = next((b for b in chrome_bins if b and os.path.exists(b)), None)
    if not chrome_bin:
        print(f"❌ Error: Could not find Chrome or Chromium binary to convert {html_path} to PDF.")
        return False

    temp_profile = f"/tmp/chrome-pdf-{os.getpid()}"
    os.makedirs(temp_profile, exist_ok=True)

    cmd = [
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-crash-reporter",
        "--crash-dumps-dir=/tmp",
        f"--user-data-dir={temp_profile}",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}",
        html_path
    ]

    print(f"Converting '{html_path}' -> '{pdf_path}' via Headless Chrome...")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000:
        size_mb = os.path.getsize(pdf_path) / (1024.0 * 1024.0)
        print(f"✅ Generated PDF successfully: {pdf_path} ({size_mb:.2f} MB)")
        return True
    else:
        print(f"❌ Failed to generate {pdf_path}: {res.stderr.decode('utf-8', errors='ignore')}")
        return False

if __name__ == "__main__":
    tasks = [
        {
            "name": "Complete Codebase",
            "files": ALL_FILES,
            "title": "Guardian Eye AI — Complete Source Codebase",
            "subtitle": "Full Architectural Source Code — Frontend React/Capacitor App, FastAPI Core Backend, Audio/Video Diarization & Scoring Pipeline, and Firebase Cloud Infrastructure",
            "html": "Guardian_Eye_AI_Complete_Codebase.html",
            "pdf": "Guardian_Eye_AI_Complete_Codebase.pdf"
        },
        {
            "name": "Backend & Cloud Core",
            "files": [f for f in ALL_FILES if "Backend" in f[0] or "Cloud" in f[0]],
            "title": "Guardian Eye AI — Backend & Cloud Architecture",
            "subtitle": "FastAPI Core Services, Audio Diarization, Groq & Gemini Pipeline, WebRTC Peer Signaling, and Firebase Cloud Infrastructure",
            "html": "Guardian_Eye_AI_Backend_Codebase.html",
            "pdf": "Guardian_Eye_AI_Backend_Codebase.pdf"
        },
        {
            "name": "Frontend & Mobile App",
            "files": [f for f in ALL_FILES if "Frontend" in f[0]],
            "title": "Guardian Eye AI — Frontend & Mobile Codebase",
            "subtitle": "React 19 Single Page Application, WebRTC Live HUD, Post-Meeting Intelligence Dashboard, Capacitor Android Bridge, and Design System",
            "html": "Guardian_Eye_AI_Frontend_Codebase.html",
            "pdf": "Guardian_Eye_AI_Frontend_Codebase.pdf"
        }
    ]

    for t in tasks:
        print("=" * 65)
        print(f"Processing: {t['name']}")
        html_content, count, lines, b_size = generate_html(t["files"], t["title"], t["subtitle"])
        with open(t["html"], "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"Wrote {t['html']} ({count} files, {lines:,} lines, {b_size/(1024*1024):.2f} MB)")
        convert_html_to_pdf(t["html"], t["pdf"])

    print("\n" + "=" * 65)
    print("ALL CODEBASE PDFS GENERATED SUCCESSFULLY!")
    print("=" * 65)
