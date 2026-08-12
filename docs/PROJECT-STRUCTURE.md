# Project structure

- `app/domain`: pure domain rules, models, validation, and safety policies.
- `app/adapters`: external boundaries for FxAPI, AI providers, notifications, storage, credentials, updates, and Codex App Server.
- `app/main`: Electron main process and runtime orchestration.
- `app/preload`: minimal typed IPC bridge.
- `app/renderer`: React desktop interface.
- `app/rules`: built-in deterministic detection rules.
- `tests/unit`: isolated behavior tests.
- `tests/integration`: storage, scheduler, and monitoring pipeline tests.
- `tests/e2e`: packaged Electron smoke tests.
- `research`: offline source collection, reviewed datasets, and rule evaluation. It must not enter the packaged runtime.
- `docs`: user, privacy, release, troubleshooting, and architecture documentation.
- `scripts`: build, verification, cleanup, and local reset utilities.

Root-level `.cmd` files are deliberate user entry points:

- `start-tibo-watch.cmd`: build and start the current development version.
- `reset-tibo-watch.cmd`: clear Tibo Watch local state for a clean first-run test.

Generated directories are not source code. Run `npm run clean` to remove build and test output, or `npm run clean:all` to remove those outputs plus unpublished release artifacts.
