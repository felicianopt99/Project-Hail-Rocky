FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    ffmpeg \
    libasound2-dev \
    curl \
    && curl -sL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g prisma \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy prisma schema first for generation
COPY prisma/ /app/prisma/
RUN prisma generate --schema=/app/prisma/schema.prisma

# Copy backend code
COPY backend/ .

# Expose port
EXPOSE 8000

# Start command - run from /app directory where main.py is located
CMD ["uvicorn", "app.main:sio_app", "--host", "0.0.0.0", "--port", "8000"]
