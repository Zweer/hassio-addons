# Maintainer's self-hosted, on-demand archiver (NOT the Home Assistant addon).
# See ./README.md. Thin wrapper so you don't have to remember the one-shot flags.

# Byparr has `restart: unless-stopped`, so a plain `docker compose up` leaves it
# running after the archiver's single pass and the command hangs. These flags
# stop the whole stack as soon as the archiver exits and propagate its exit code.
COMPOSE := docker compose
RUN_FLAGS := --abort-on-container-exit --exit-code-from archiver

.DEFAULT_GOAL := run

.PHONY: run build logs down

## run: Byparr -> one archive pass -> whole stack exits (exit code = archiver's)
run:
	$(COMPOSE) up $(RUN_FLAGS)

## build: rebuild the archiver image without running a pass
build:
	$(COMPOSE) build archiver

## logs: follow logs of the running stack
logs:
	$(COMPOSE) logs -f

## down: stop and remove the stack (containers, network)
down:
	$(COMPOSE) down
