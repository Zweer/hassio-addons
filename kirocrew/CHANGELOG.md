# Changelog

## [0.2.14](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.13...kirocrew-v0.2.14) (2026-08-25)


### Bug Fixes

* disable warm pool to prevent OOM on RPi4 ([54dffab](https://github.com/Zweer/hassio-addons/commit/54dffab5607c3e74a24ea232ea9a6ad761e7ab58))

## [0.2.13](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.12...kirocrew-v0.2.13) (2026-08-24)


### Bug Fixes

* disable local embeddings and clear crash dumps on startup ([069dbd9](https://github.com/Zweer/hassio-addons/commit/069dbd994c0912dd9b50d385bd11850d861ad594))

## [0.2.12](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.11...kirocrew-v0.2.12) (2026-08-21)


### Features

* add kiro_api_key option for headless authentication ([6157f50](https://github.com/Zweer/hassio-addons/commit/6157f502d3bc9c8c24784490afde8a54a431a497))

## [0.2.11](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.10...kirocrew-v0.2.11) (2026-08-07)


### Features

* generate 1-year dashboard token at startup and print in logs ([2e69e9a](https://github.com/Zweer/hassio-addons/commit/2e69e9abf18bbe5d489563e80fb2058e85e9fa8f))

## [0.2.10](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.9...kirocrew-v0.2.10) (2026-08-07)


### Bug Fixes

* revert user IDs to proper int/str arrays in schema ([9a28581](https://github.com/Zweer/hassio-addons/commit/9a285819c5d0fbb5e06099b495071b8f9d4bb570))

## [0.2.9](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.8...kirocrew-v0.2.9) (2026-08-07)


### Bug Fixes

* **ci:** separate build jobs per addon + fix kirocrew symlink ([2e01bba](https://github.com/Zweer/hassio-addons/commit/2e01bba9b3c90fc0a08b3393bcf8f781b7ede37c))

## [0.2.8](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.7...kirocrew-v0.2.8) (2026-08-07)


### Bug Fixes

* **kirocrew:** add SHELL pipefail for hadolint DL4006 ([4b6083e](https://github.com/Zweer/hassio-addons/commit/4b6083e56eaf2981942303e6bda819494a93884b))

## [0.2.7](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.6...kirocrew-v0.2.7) (2026-08-06)


### Bug Fixes

* change user ID fields to comma-separated strings for simpler UI ([aa57f9d](https://github.com/Zweer/hassio-addons/commit/aa57f9dd7489a0c4cfbaeb3d6ebea4acadc4c043))

## [0.2.6](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.5...kirocrew-v0.2.6) (2026-08-06)


### Bug Fixes

* use proper HA addon schema syntax for array fields ([8edfeca](https://github.com/Zweer/hassio-addons/commit/8edfecaae8899d7732bfdaab48cbfa3ea780f651))

## [0.2.5](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.4...kirocrew-v0.2.5) (2026-08-06)


### Bug Fixes

* quote schema values in config.yaml to fix YAML parsing ([388a870](https://github.com/Zweer/hassio-addons/commit/388a87090f148e8345158286bcd2679f472afaa8))

## [0.2.4](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.3...kirocrew-v0.2.4) (2026-08-06)


### Features

* add Discord and Slack channel integration options ([27ae9dd](https://github.com/Zweer/hassio-addons/commit/27ae9dd77649f3fa701640f3918e46ebd7ec9b60))

## [0.2.3](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.2...kirocrew-v0.2.3) (2026-08-06)


### Bug Fixes

* run gateway as kirocrew user to fix kiro-cli auth in subprocesses ([81a89f0](https://github.com/Zweer/hassio-addons/commit/81a89f0072bdacb2475c11b123c873c2b0291adf))

## [0.2.2](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.1...kirocrew-v0.2.2) (2026-08-06)


### Bug Fixes

* simplify HOME handling and remove kiro_api_key option ([2b602a4](https://github.com/Zweer/hassio-addons/commit/2b602a4b4101a1d5f9efb6a9f22d96bc0869fa27))

## [0.2.1](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.2.0...kirocrew-v0.2.1) (2026-08-06)


### Features

* add kiro_api_key, auto-generate dashboard token, fix HOME env ([827f74e](https://github.com/Zweer/hassio-addons/commit/827f74ec3331012e96a6d06f66c983d3784bb533))

## [0.2.0](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.15...kirocrew-v0.2.0) (2026-08-06)


### ⚠ BREAKING CHANGES

* cloudflare_tunnel_token and cloudflare_tunnel_hostname options have been removed. Use the external_url option instead and manage tunnels via the Cloudflared HA addon.

### Features

* add cloudflare_tunnel_hostname option for dashboard.url ([6ed29d1](https://github.com/Zweer/hassio-addons/commit/6ed29d102e69d40b7b62878f288b53102fe3b52c))


### Refactoring

* remove built-in cloudflared, use external_url option instead ([8c2fe73](https://github.com/Zweer/hassio-addons/commit/8c2fe73fb261e8ad89323329eb34ef79f77e59aa))

## [0.1.15](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.14...kirocrew-v0.1.15) (2026-08-06)


### Features

* replace nginx proxy with Cloudflare Tunnel for external access ([61f535e](https://github.com/Zweer/hassio-addons/commit/61f535eeeb09ca46843b91ab5ee12927eee21e37))

## [0.1.14](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.13...kirocrew-v0.1.14) (2026-08-06)


### Features

* add nginx ingress proxy with sub_filter for path rewriting ([0f4b316](https://github.com/Zweer/hassio-addons/commit/0f4b3169e9633151c9ccc8a9edbe05ace8490066))

## [0.1.13](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.12...kirocrew-v0.1.13) (2026-08-05)


### Features

* auto-discover external URL from Supervisor API for ingress ([a5c9cdb](https://github.com/Zweer/hassio-addons/commit/a5c9cdb1ae15646593e1e3b89789d14e18dcf4a1))

## [0.1.12](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.11...kirocrew-v0.1.12) (2026-08-05)


### Bug Fixes

* remove KIROCREW_HOME from config.yaml and symlink entire .kiro dir ([9f2dda6](https://github.com/Zweer/hassio-addons/commit/9f2dda603ce8a686db45b3665afae47f1be14178))

## [0.1.11](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.10...kirocrew-v0.1.11) (2026-08-05)


### Bug Fixes

* cd /data after symlink to avoid stale CWD error ([4212a73](https://github.com/Zweer/hassio-addons/commit/4212a73a6583a2f7fd3d02d4b1bb7c370ea32c2c))
* rewrite persistence strategy - symlink data dirs instead of ([8b875af](https://github.com/Zweer/hassio-addons/commit/8b875af93ccde9037cb201b2fac2205cff3db11a))

## [0.1.10](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.9...kirocrew-v0.1.10) (2026-08-05)


### Bug Fixes

* symlink /home/kirocrew to /data for full state persistence ([bd70df1](https://github.com/Zweer/hassio-addons/commit/bd70df16dd288fb4d7e382bbee4924043a6ac048))

## [0.1.9](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.8...kirocrew-v0.1.9) (2026-08-05)


### Bug Fixes

* set KIROCREW_CORS_ORIGINS for ingress and fix config.json path ([7de126c](https://github.com/Zweer/hassio-addons/commit/7de126c127799366f07a1ac5ae9259cb9a4b8dc2))

## [0.1.8](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.7...kirocrew-v0.1.8) (2026-08-05)


### Bug Fixes

* persist kiro-cli credentials and allow all hosts for HA ingress ([eae0eba](https://github.com/Zweer/hassio-addons/commit/eae0eba576d54b07c4c5230a95007f8fd2398a52))

## [0.1.7](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.6...kirocrew-v0.1.7) (2026-08-05)


### Bug Fixes

* use env vars instead of unsupported CLI flags for kirocrew gateway ([f671db4](https://github.com/Zweer/hassio-addons/commit/f671db40f6d8cf6aa1bc926c67c4e6c687ee8ce2))

## [0.1.6](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.5...kirocrew-v0.1.6) (2026-08-05)


### Bug Fixes

* move USER root before RUN to fix apt-get permission denied during ([d0a9c03](https://github.com/Zweer/hassio-addons/commit/d0a9c031bd69c5d47e364827790ccb1fb1a1737a))

## [0.1.5](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.4...kirocrew-v0.1.5) (2026-08-05)


### Features

* add gh CLI to Dockerfile for GitHub operations ([980d000](https://github.com/Zweer/hassio-addons/commit/980d000b713e229dbf37f78eee60417a5e7feae4))


### Bug Fixes

* run as root to resolve /data/options.json permission denied ([22414f5](https://github.com/Zweer/hassio-addons/commit/22414f553bda10115d297f7c5ab5a777849c729d))

## [0.1.4](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.3...kirocrew-v0.1.4) (2026-08-05)


### Bug Fixes

* **kirocrew:** make jq install robust, skip if already present in base image ([22db688](https://github.com/Zweer/hassio-addons/commit/22db688a290a0863c086d8e54242547c7718e97b))
* **kirocrew:** replace jq with python3 for JSON parsing ([cdbcd8f](https://github.com/Zweer/hassio-addons/commit/cdbcd8fe2e697d439c25a3b29bd53e7c06c2d290))
* **kirocrew:** use COPY --chmod to avoid permission issues in base image ([2df852c](https://github.com/Zweer/hassio-addons/commit/2df852c8563f509e163813f090d6f0144e93f4bc))

## [0.1.3](https://github.com/Zweer/hassio-addons/compare/kirocrew-v0.1.2...kirocrew-v0.1.3) (2026-08-05)


### Bug Fixes

* **kirocrew:** document CI/CD in changelog ([e019d31](https://github.com/Zweer/hassio-addons/commit/e019d31069760ffc14e6c3929368fd01810ab6fa))

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
