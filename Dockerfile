# 1. Use a lightweight Python base image
FROM python:3.10-slim

# Prevent Python from buffering stdout/stderr and generating .pyc files
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 2. Install system-level dependencies: ffmpeg and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set application working directory
WORKDIR /app

# 3. Copy requirements.txt and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 4. Copy the rest of the application code into the container
COPY . .

# Ensure upload and audio extraction output directories exist
RUN mkdir -p uploads/audio backend/uploads/audio

# Configure PYTHONPATH so root and backend modules resolve cleanly
ENV PYTHONPATH="/app:/app/backend:${PYTHONPATH}"

# 5. Expose the port dynamically using the $PORT environment variable as required by Render
ENV PORT=10000
EXPOSE 10000

# 6. Set the CMD to run Uvicorn pointing to the main app entrypoint
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}
