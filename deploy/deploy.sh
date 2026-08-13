#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${AWS_PROFILE:?AWS_PROFILE is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required and must be unique}"
: "${APP_USER:?APP_USER is required}"
: "${APP_PASSWORD:?APP_PASSWORD is required}"
SHOE_DATA_BUCKET="${SHOE_DATA_BUCKET:-scanalytics-report}"

export AWS_PAGER=""
repository="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/excel-transformer"

docker build --platform linux/amd64 -t "${repository}:${IMAGE_TAG}" .
aws ecr get-login-password --region "${AWS_REGION}" --profile "${AWS_PROFILE}" |
  docker login --username AWS --password-stdin "${repository}"
docker push "${repository}:${IMAGE_TAG}"

task_definition="$(
  sed \
    -e "s/\${AWS_ACCOUNT_ID}/${AWS_ACCOUNT_ID}/g" \
    -e "s/\${AWS_REGION}/${AWS_REGION}/g" \
    -e "s/\${IMAGE_TAG}/${IMAGE_TAG}/g" \
    deploy/task-definition.json |
    jq \
      --arg app_user "${APP_USER}" \
      --arg app_password "${APP_PASSWORD}" \
      --arg aws_region "${AWS_REGION}" \
      --arg shoe_data_bucket "${SHOE_DATA_BUCKET}" \
      '.containerDefinitions[0].environment = [
        {"name": "APP_USER", "value": $app_user},
        {"name": "APP_PASSWORD", "value": $app_password},
        {"name": "AWS_REGION", "value": $aws_region},
        {"name": "SHOE_DATA_BUCKET", "value": $shoe_data_bucket}
      ]'
)"

task_arn="$(
  aws ecs register-task-definition \
    --cli-input-json "${task_definition}" \
    --region "${AWS_REGION}" \
    --profile "${AWS_PROFILE}" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text
)"

aws ecs update-service \
  --cluster excel-transformer-cluster \
  --service excel-transformer \
  --task-definition "${task_arn}" \
  --force-new-deployment \
  --region "${AWS_REGION}" \
  --profile "${AWS_PROFILE}" >/dev/null

aws ecs wait services-stable \
  --cluster excel-transformer-cluster \
  --services excel-transformer \
  --region "${AWS_REGION}" \
  --profile "${AWS_PROFILE}"

echo "Deployment completed: ${task_arn}"
