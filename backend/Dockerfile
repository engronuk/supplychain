# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# TradeKonekt Backend — Cloud Run container
# ----------------------------------------------------------------------------
# Build:
#   gcloud builds submit --tag europe-west2-docker.pkg.dev/$PROJECT/tk/backend ./backend
# Deploy:
#   gcloud run deploy tk-backend \
#     --image=europe-west2-docker.pkg.dev/$PROJECT/tk/backend \
#     --region=europe-west2 \
#     --service-account=emergent-agent@$PROJECT.iam.gserviceaccount.com \
#     --set-env-vars=GCP_PROJECT_ID=$PROJECT,BIGQUERY_DATASET=pulse,BIGQUERY_LOCATION=europe-west2,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=europe-west2,GOOGLE_GENAI_USE_VERTEXAI=true,GENAI_MODEL_ID=gemini-2.5-flash \
#     --set-secrets=MONGO_URL=mongo-url:latest,DB_NAME=db-name:latest,JWT_SECRET=jwt-secret:latest \
#     --allow-unauthenticated
#
# Note: on Cloud Run the attached service account is used via ADC, so we do
# NOT bake a GCP JSON key into the image. Local dev keeps the file mounted.
# ----------------------------------------------------------------------------

FROM python:3.11-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install -r requirements.txt

FROM python:3.11-slim
ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PORT=8080 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY . /app
# Secrets are NEVER baked in. Mount via Secret Manager at runtime.
RUN rm -rf /app/secrets /app/.env

EXPOSE 8080
CMD exec gunicorn --bind :$PORT --workers 2 --worker-class uvicorn.workers.UvicornWorker --timeout 90 server:app
