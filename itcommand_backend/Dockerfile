# ITCommand backend — Django + Gunicorn
FROM python:3.12-slim

# - Don't write .pyc files, and stream logs straight to the console.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Python deps first so this layer is cached unless requirements change.
# psycopg2-binary / Pillow / cryptography all ship prebuilt wheels, so no
# system build toolchain is required here.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY . .

# Startup script: migrate -> collectstatic -> gunicorn.
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
