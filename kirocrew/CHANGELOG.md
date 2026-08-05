# Changelog

## [0.1.2](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.1...kirocrew-v0.1.2) (2026-08-05)


### Bug Fixes

* **kirocrew:** add startup log for ingress availability ([a1b9205](https://github.com/Zweer/hassio-addons/commit/a1b92050080bfb13b509668a4f3b3dc94599aab5))

## [0.1.1](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.0...kirocrew-v0.1.1) (2026-08-04)


### Features

* **kirocrew:** initial addon for Kiro Crew on Home Assistant ([37e3bc3](https://github.com/Zweer/hassio-addons/commit/37e3bc389629706ff18fafd518273d80475f3c4a))

## 0.1.0

- Initial release
- Ingress integration with Home Assistant
- RPi4 4GB optimized defaults (pool_size=1, sandbox=off)
- Configurable session pool size, telemetry, and log level
- Persistent data in /data with HA backup support
- Watchdog for automatic restart on gateway failure
- CI/CD with release-please and Docker multi-arch builds
