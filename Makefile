.PHONY: install dev lint format check test test-worker test-browser test-intake build verify

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

test-worker:
	pnpm --filter @code-assist/worker test:integration

test-browser:
	pnpm --filter @code-assist/browser-mcp test:integration

test-intake:
	pnpm --filter @code-assist/intake test:integration

verify: lint check test build
