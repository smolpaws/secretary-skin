# The Secretary — an Agent Canvas skin

A conversation-manager board for the insider SmolPaws cat, packaged as an
[Agent Canvas skin](https://github.com/OpenHands/OpenHands) (git-backed
per-instance UI).

It shows the instance's conversations as a fixed four-column board
(**Pending · In progress · Needs input · Done**), with a prompt box wired to
the real agent brain and realtime voice (click the cat).

## As a skin

Installed through the Canvas skin runtime, which clones this repo, runs
`npm run start` on `OPENHANDS_SKIN_PORT`, and reverse-proxies it under `/skin`
with a sidebar nav entry (name + icon from `skin.yaml`).

- `skin.yaml` — name, lucide `icon`, `canvas_version`. No reconfig blocks, so
  installing it does not change the host's agent settings.
- `package.json` — `start` script (`node server.mjs`, honors
  `OPENHANDS_SKIN_PORT` / `PORT`).
- `SKILL.md` — loaded into the agent's context as an always-active skill.

## Standalone

```
PORT=4820 AGENT_SERVER_URL=http://127.0.0.1:18000 node server.mjs
# open http://127.0.0.1:4820/
```

The server reads secrets from the environment / local files at runtime
(`AGENT_SERVER_KEY` or `~/.openhands/agent-canvas/api-key.txt`, ChatGPT auth
from `~/.codex/auth.json`); none are baked into the source.
