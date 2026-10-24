FROM python:3.11-slim

# Prevent python from buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies including FFmpeg for system-level 16kHz mono audio extraction loops
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY . .

# Create uploads directory for audio extraction outputs
RUN mkdir -p uploads/audio

# Set the runtime environment to explicitly bind to dynamic $PORT variable required by Render's routing mesh
ENV PORT=10000
EXPOSE 10000

CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}
