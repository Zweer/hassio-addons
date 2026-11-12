# Maintainer's self-hosted, on-demand archiver (NOT the Home Assistant addon).
# See ./README.md. Thin wrapper so you don't have to remember the one-shot flags.

# Byparr has `restart: unless-stopped`, so a plain `docker compose up` leaves it
# running after the archiver's single pass and the command hangs. These flags
# stop the whole stack as soon as the archiver exits and propagate its exit code.
COMPOSE := docker compose
RUN_FLAGS := --abort-on-container-exit --exit-code-from archiver

.DEFAULT_GOAL := run

.PHONY: run build logs down

## run: rebuild archiver -> Byparr -> one archive pass -> whole stack exits
# `--build` forces a fresh archiver image from the current src/ on every run.
# Without it, `docker compose up` reuses a cached image and silently runs STALE
# code after you edit the source — so a code change wouldn't take effect until a
# manual `make build`. Always building keeps `make run` honest.
run:
	$(COMPOSE) up --build $(RUN_FLAGS)

## build: rebuild the archiver image without running a pass
build:
	$(COMPOSE) build archiver

## logs: follow logs of the running stack
logs:
	$(COMPOSE) logs -f

## down: stop and remove the stack (containers, network)
down:
	$(COMPOSE) down
