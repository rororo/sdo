SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.ONESHELL:

AWS_PROFILE ?= xebio
AWS_REGION ?= ap-northeast-1
AWS_ACCOUNT_ID ?=
IMAGE_TAG ?= $(shell git rev-parse --short HEAD)
SHOE_DATA_BUCKET ?= scanalytics-report
PROJECT_NAME ?= excel-transformer
ECS_CLUSTER ?= $(PROJECT_NAME)-cluster
ECS_SERVICE ?= $(PROJECT_NAME)
TASK_DEFINITION_FILE ?= deploy/task-definition.json

.PHONY: install dev check test build docker-build help deploy

install:
	deno install

dev:
	deno task dev

check:
	deno task check

test:
	deno task test

build:
	deno task build

docker-build:
	docker build -t excel-transformer:local .

help:
	@printf '%s\n' \
		'make install' \
		'make dev' \
		'make check' \
		'make test' \
		'make build' \
		'make docker-build' \
		'make deploy' \
		'make deploy IMAGE_TAG=<unique-tag>' \
		'make deploy AWS_PROFILE=<profile> AWS_REGION=<region>'

deploy:
	@for command in aws docker jq sed; do
		command -v "$${command}" >/dev/null || {
			echo "Required command is not available: $${command}" >&2
			exit 1
		}
	done
	test -f "$(TASK_DEFINITION_FILE)" || {
		echo "Task definition template was not found: $(TASK_DEFINITION_FILE)" >&2
		exit 1
	}

	export AWS_PAGER=""
	aws_account_id="$(AWS_ACCOUNT_ID)"
	if [[ -z "$${aws_account_id}" ]]; then
		aws_account_id="$$(
			aws sts get-caller-identity \
				--profile "$(AWS_PROFILE)" \
				--region "$(AWS_REGION)" \
				--query Account \
				--output text
		)"
	fi
	image_tag="$(IMAGE_TAG)"
	if [[ -z "$${image_tag}" ]]; then
		echo 'IMAGE_TAG must not be empty.' >&2
		exit 1
	fi

	registry="$${aws_account_id}.dkr.ecr.$(AWS_REGION).amazonaws.com"
	repository="$${registry}/$(PROJECT_NAME)"

	docker build --platform linux/amd64 -t "$${repository}:$${image_tag}" .
	aws ecr get-login-password \
		--region "$(AWS_REGION)" \
		--profile "$(AWS_PROFILE)" |
		docker login --username AWS --password-stdin "$${registry}"
	docker push "$${repository}:$${image_tag}"

	auth_secret_arn="$$(
		aws secretsmanager describe-secret \
			--secret-id "$(PROJECT_NAME)/auth" \
			--region "$(AWS_REGION)" \
			--profile "$(AWS_PROFILE)" \
			--query ARN \
			--output text
	)"

	task_definition="$$(
		sed \
			-e "s/\$${AWS_ACCOUNT_ID}/$${aws_account_id}/g" \
			-e "s/\$${AWS_REGION}/$(AWS_REGION)/g" \
			-e "s/\$${IMAGE_TAG}/$${image_tag}/g" \
			"$(TASK_DEFINITION_FILE)" |
			jq \
				--arg aws_region "$(AWS_REGION)" \
				--arg shoe_data_bucket "$(SHOE_DATA_BUCKET)" \
				--arg auth_secret_arn "$${auth_secret_arn}" \
				'.containerDefinitions[0].environment = [
				  {"name": "AWS_REGION", "value": $$aws_region},
				  {"name": "SHOE_DATA_BUCKET", "value": $$shoe_data_bucket}
				] |
				.containerDefinitions[0].secrets = [
				  {"name": "APP_USER", "valueFrom": ($$auth_secret_arn + ":APP_USER::")},
				  {"name": "APP_PASSWORD_HASH", "valueFrom": ($$auth_secret_arn + ":APP_PASSWORD_HASH::")}
				]'
	)"

	task_arn="$$(
		aws ecs register-task-definition \
			--cli-input-json "$${task_definition}" \
			--region "$(AWS_REGION)" \
			--profile "$(AWS_PROFILE)" \
			--query 'taskDefinition.taskDefinitionArn' \
			--output text
	)"

	aws ecs update-service \
		--cluster "$(ECS_CLUSTER)" \
		--service "$(ECS_SERVICE)" \
		--task-definition "$${task_arn}" \
		--force-new-deployment \
		--region "$(AWS_REGION)" \
		--profile "$(AWS_PROFILE)" >/dev/null

	aws ecs wait services-stable \
		--cluster "$(ECS_CLUSTER)" \
		--services "$(ECS_SERVICE)" \
		--region "$(AWS_REGION)" \
		--profile "$(AWS_PROFILE)"

	echo "Deployment completed: $${task_arn}"
