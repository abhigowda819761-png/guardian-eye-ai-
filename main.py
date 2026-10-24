import os
import sys

# Ensure backend directory is in sys.path for direct module resolution
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from backend.main import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    print(f"[GuardianEye AI] Starting FastAPI on host 0.0.0.0, port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port)
