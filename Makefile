.PHONY: install dev check test build docker-build

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
