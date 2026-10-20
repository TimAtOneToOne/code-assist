.PHONY: install dev lint format check test build verify

install:
	pnpm install --frozen-lockfile

dev:
	pnpm dev

lint:
	pnpm lint

format:
	pnpm format

check:
	pnpm check

build:
	pnpm build

test:
	pnpm test

verify: lint check test build
