# Public source release

This is the standalone source distribution for dsh-instruction-files.
Only plugin source and example configuration belong here. Do not commit user
sessions, credentials, databases, or a full DSH installation.

Requires a compatible DeepSeek Harness host providing the peer services from package.json.
The CI runs host-free tests; a passing result does not imply real Discord, Feishu, or browser integration.
The included client code is already generated, so standard installation needs no generator.
Replace <DSH_ROOT> in legacy documentation examples with your DSH install path.
Upstream third-party dependencies retain their own licenses.

UI generation: node tools/settings/build.mjs (full rebuild requires matching DSH host packages).
