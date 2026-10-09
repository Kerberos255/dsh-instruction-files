# Instruction Files & Agent Profiles for DeepSeek Harness

[简体中文](README.zh-CN.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [Security](SECURITY.md)

Manage **workspace instructions, agent identities, and per-profile defaults** in DSH without replacing the host's native agent, permissions, or session history.

## Features

- Opt-in Markdown prompt sections: `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `USER.md`, and `MEMORY.md`.
- Optional replacement of the native identity section with `IDENTITY.md`; other named prompt sections are **plugin-defined**, not native DSH section names.
- Reloads changed workspace instructions on the next model step while avoiding duplicate injection.
- Manages custom agent profiles with workspace, model and permission defaults for **new** sessions.
- Cooperates with [Dream & Memory](https://github.com/Kerberos255/dsh-memory-dreaming) and [Channel Core](https://github.com/Kerberos255/dsh-channel-core) to avoid untrusted private memory injection.

## Install

Requires a compatible DSH host; check [package.json](package.json) for runtime and peer dependencies.

```sh
dsh plugin --profile desktop add github:Kerberos255/dsh-instruction-files
```

Replace the example profile with yours; restart after installation or code updates.

## Quick start

1. Open **Settings → Plugins → Instruction Files & Profiles**.
2. Select the workspace and enable the master workspace-prompt option (off by default).
3. Add only the Markdown files you intend to use, then enable each corresponding section.
4. Optionally create a custom agent profile with its own **new-session** model/permission defaults.

Example workspace root:

```text
workspace/
  IDENTITY.md
  SOUL.md
  AGENTS.md
  TOOLS.md
  USER.md
  MEMORY.md
```

`IDENTITY.md` controls identity; `SOUL.md` holds behavior/style preferences. `MEMORY.md` is sensitive: in private channels, access must pass owner verification and the plugin's memory boundary. Changing files does not retroactively rewrite a running model request.

## Notes and tests

Changing a default affects new sessions, **not existing conversations**. Disabled sections fall back to native DSH behavior. The plugin does not create user instruction files or evaluate template expressions.

Run `npm test` for standalone prompt/memory-filter checks. Config template: [config.example.json](config.example.json).

MIT licensed. See [LICENSE](LICENSE).
