# Cloud Run / Cloud Build helper — TradeKonekt Backend
# ----------------------------------------------------
# Usage (run once GCP project + Artifact Registry repo exist):
#
#   PROJECT=project-905e8cc5-7104-437c-825
#   REGION=europe-west2
#   gcloud config set project $PROJECT
#   gcloud artifacts repositories create tk --repository-format=docker --location=$REGION
#
#   # Upload secrets (do this only once; rotate via secret versions thereafter)
#   echo -n "$MONGO_URL" | gcloud secrets create mongo-url --data-file=-
#   echo -n "$DB_NAME"   | gcloud secrets create db-name   --data-file=-
#   echo -n "$JWT_SECRET" | gcloud secrets create jwt-secret --data-file=-
#
#   # Grant the runtime SA access
#   SA=emergent-agent@$PROJECT.iam.gserviceaccount.com
#   for ROLE in roles/bigquery.dataEditor roles/bigquery.jobUser roles/aiplatform.user roles/secretmanager.secretAccessor roles/run.invoker; do
#     gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role=$ROLE
#   done
#
#   # Build
#   gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT/tk/backend ./backend
#
#   # Deploy
#   gcloud run deploy tk-backend \
#     --image=$REGION-docker.pkg.dev/$PROJECT/tk/backend \
#     --region=$REGION \
#     --service-account=$SA \
#     --memory=1Gi --cpu=2 --timeout=120 \
#     --set-env-vars=GCP_PROJECT_ID=$PROJECT,BIGQUERY_DATASET=pulse,BIGQUERY_LOCATION=$REGION,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=$REGION,GOOGLE_GENAI_USE_VERTEXAI=true,GENAI_MODEL_ID=gemini-2.5-flash \
#     --set-secrets=MONGO_URL=mongo-url:latest,DB_NAME=db-name:latest,JWT_SECRET=jwt-secret:latest \
#     --allow-unauthenticated
#
#   # Schedule the hourly alert generator
#   gcloud scheduler jobs create http tk-pulse-alerts \
#     --schedule="0 * * * *" --time-zone=UTC \
#     --uri=https://tk-backend-xxxx-$REGION.a.run.app/api/pulse/alerts \
#     --http-method=GET \
#     --oidc-service-account-email=$SA
