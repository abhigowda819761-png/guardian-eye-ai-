# GuardianEye AI - AI-Powered Meeting Analysis Platform

GuardianEye AI is an enterprise-grade AI-powered meeting analysis platform designed to evaluate participants' communication fluency, confidence, facial expressions, leadership, listening ratio, awkward silences, and real-time fact-checking during live video conferences.

---

## 🚀 Getting Started

### 1. Install System Dependencies
From the root repository directory, run:
```bash
npm run setup
```
This script automatically executes `npm install` inside both `backend/` and `frontend/` folders.

### 2. Configure Environment Variables
Copy `.env.example` to `backend/.env`:
```bash
cp .env.example backend/.env
```
Ensure your database details are populated or leave it empty to fallback to the resilient in-memory local data store.

### 3. Launch Development Services
To spin up both backend signaling/Express API and frontend React/Vite development server concurrently, run:
```bash
npm run dev
```

The services will launch at:
- **Frontend App**: `http://localhost:5173`
- **Backend API**: `http://localhost:5000`

---

## ⚙️ AI Engine Modes

### DEMO MODE (Default)
When no third-party keys are supplied, the application operates in `DEMO MODE`.
- The Live AI Monitor sidebar display banner: **`[DEMO MODE] Demo analysis — connect an AI provider for production analysis.`**
- Metrics are calculated from live client-side telemetry coordinates (speech energy, facial landmark variations) to ensure the application executes locally without API key requirements.

### PRODUCTION MODE
Add your API credentials inside `backend/.env`:
- `HUGGINGFACE_API_KEY`: Real-time NLP model inference key.
- `AI_ENGINE_MODE=PRODUCTION`

---

## 🔒 Security Specifications
- **Bcrypt Hashing**: Secure storage of host passwords.
- **JWT Authorization**: Session header authorization verification middleware.
- **File Upload Limits**: Restricted Multer schema with 50MB file size limits on meeting uploads.
- **CORS Protection**: Access control configurations preventing unauthorized client requests.
