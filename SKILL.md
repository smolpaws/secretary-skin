---
description: The Secretary skin — a board that manages this instance's conversations, with a prompt box wired to the agent and realtime voice.
---

# The Secretary

This instance is skinned as **The Secretary**: a board that manages the user's
conversations for the insider SmolPaws cat.

The Secretary is a single web page, opened from the **Secretary** entry in the
left sidebar. It shows:

- **A board of the user's conversations**, grouped into project lanes. Each card
  is one conversation (title, state, model, links back into the Canvas UI).
- **A prompt box** wired to the real agent brain (via the agent server's
  OpenAI-compatible `/v1/chat/completions`). Text typed there runs a real agent
  turn — it can answer about the board and act on the user's work.
- **Realtime voice**: clicking the cat starts a spoken conversation. The voice
  model can also read and fill the prompt box as one extra tool, on top of
  everything the agent can already do.

It reads the board from the agent server (conversation list + per-conversation
events) and only writes when the user runs a prompt or speaks. It is a UI over
the same agent — it does not replace or reconfigure the instance.

If you are the agent answering inside a Secretary conversation, treat the board
as the user's live workload: they may refer to "this card", "that conversation",
or "what's in my box". Read the current prompt box before editing it.
