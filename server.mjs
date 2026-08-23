// The Secretary — board + prompt box + voice (smolpaws-s9e.1).
//
// Self-referential demo of "this big round": project lanes = our epics, the
// beads inside each are OUR beads, and each project's conversations nest under
// it. It is NOT read-only: there is a prompt box (typed -> the agent brain via
// /v1/chat/completions), and clicking the cat starts realtime voice, where the
// voice model can also drive the prompt box (fill/clear) as ONE extra tool on
// top of everything the agent can already do.
//
// Read-only against the agent-server for board reads; the prompt box runs agent
// turns. Does not touch the live Purr Projects skin.
//
// Run:  PORT=4820 node server.mjs   then open http://127.0.0.1:4820/

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const PORT = Number(process.env.PORT || 4820);
const AGENT_BASE = process.env.AGENT_SERVER_URL || "http://127.0.0.1:18100";
// Canvas UI base for "open this conversation" deep links. The demo Canvas UI
// (with the insider cat) is served at :12000; override with CANVAS_UI_URL.
const CANVAS_UI_URL = process.env.CANVAS_UI_URL || "http://127.0.0.1:12000";
const AGENT_MODEL = process.env.SECRETARY_AGENT_MODEL || "openhands_deepseek-v4-flash";
const REALTIME_MODEL = process.env.SECRETARY_RT_MODEL || "gpt-realtime";
const VOICE = process.env.SECRETARY_VOICE || "cedar";
const BEADS_JSONL =
  process.env.BEADS_JSONL ||
  join(homedir(), "repos", "smolpaws", ".beads", "issues.jsonl");
const BEADS_REPO = "smolpaws";

let AGENT_KEY = process.env.AGENT_SERVER_KEY || "";
if (!AGENT_KEY) {
  try {
    AGENT_KEY = readFileSync(
      join(homedir(), ".openhands", "agent-canvas", "api-key.txt"),
      "utf8",
    ).trim();
  } catch {
    /* leave empty */
  }
}

// --- auth for realtime voice (ChatGPT subscription, then API key) ------------

function readChatgptAuth() {
  try {
    const j = JSON.parse(
      readFileSync(join(homedir(), ".codex", "auth.json"), "utf8"),
    );
    if (j?.auth_mode === "chatgpt" && j?.tokens?.access_token) {
      return { token: j.tokens.access_token, accountId: j.tokens.account_id || "" };
    }
  } catch {
    /* none */
  }
  return null;
}

// --- the projects of "this big round" = the three epics ----------------------

const PROJECTS = [
  { id: "smolpaws-08f", key: "insider", name: "Insider Cat", blurb: "A SmolPaws living inside OpenHands" },
  { id: "smolpaws-3e1", key: "voice", name: "Realtime Voice", blurb: "Talk to the cat, it acts" },
  { id: "smolpaws-s9e", key: "secretary", name: "The Secretary", blurb: "The cat manages your conversations" },
];

function loadBeads() {
  const rows = [];
  try {
    for (const line of readFileSync(BEADS_JSONL, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
  } catch {
    /* none */
  }
  return rows;
}

async function agentGet(path) {
  const res = await fetch(`${AGENT_BASE}${path}`, {
    headers: AGENT_KEY ? { "X-Session-API-Key": AGENT_KEY } : {},
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// Run one turn of the real OpenHands agent as an LLM.
async function agentComplete(request) {
  if (!AGENT_KEY) throw new Error("no agent-server key");
  const res = await fetch(`${AGENT_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "X-Session-API-Key": AGENT_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      model: AGENT_MODEL,
      messages: [{ role: "user", content: request }],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`/v1/chat/completions -> ${res.status}`);
  const d = await res.json();
  return d?.choices?.[0]?.message?.content ?? "(no answer)";
}

function shortModel(m) {
  return m ? String(m).split("/").pop().replace(/^openhands_/, "") : null;
}

function projectForConversation(c) {
  return c.tags && c.tags.smolpaws === "insider" ? "smolpaws-08f" : null;
}

async function buildBoard() {
  const beads = loadBeads();
  const byId = new Map(beads.map((b) => [b.id, b]));
  let conversations = [];
  let convError = null;
  try {
    const d = await agentGet("/api/conversations/search?limit=60");
    conversations = (d.items || []).map((c) => ({
      id: c.id,
      title: c.title || `conversation ${String(c.id).slice(0, 8)}`,
      status: c.execution_status || "idle",
      model: shortModel(c.current_model_id || c.agent?.llm?.model),
      tags: c.tags || {},
      project: projectForConversation(c),
    }));
  } catch (e) {
    convError = String(e.message || e);
  }

  const projects = PROJECTS.map((p) => {
    const beadsHere = beads
      .filter((b) => b.id.startsWith(`${p.id}.`))
      .map((b) => ({
        id: b.id,
        title: b.title.replace(/^(insider|voice|secretary):\s*/i, ""),
        fullTitle: b.title,
        status: b.status,
        priority: b.priority,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const convs = conversations.filter((c) => c.project === p.id);
    const epic = byId.get(p.id);
    return {
      ...p,
      epicTitle: epic ? epic.title : p.name,
      beads: beadsHere,
      openCount: beadsHere.filter((t) => t.status !== "closed").length,
      doneCount: beadsHere.filter((t) => t.status === "closed").length,
      conversations: convs,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    repo: BEADS_REPO,
    canvasUiUrl: CANVAS_UI_URL,
    beadsCount: beads.length,
    convError,
    projects,
    unassigned: conversations.filter((c) => !c.project),
  };
}

// --- realtime token mint + the prompt-box tool schema ------------------------

async function mintToken() {
  const chatgpt = readChatgptAuth();
  const apiKey =
    process.env.OPENAI_API_KEY ||
    keychain("openhands", "OPENAI_API_KEY_BORIS");
  const attempts = [];
  if (chatgpt) attempts.push({ mode: "chatgpt", ...chatgpt });
  if (apiKey) attempts.push({ mode: "apikey", token: apiKey });
  const body = JSON.stringify({
    session: {
      type: "realtime",
      model: REALTIME_MODEL,
      audio: { output: { voice: VOICE }, input: { transcription: { model: "gpt-4o-mini-transcribe" } } },
    },
  });
  let lastErr = "no auth";
  for (const a of attempts) {
    const headers = { authorization: `Bearer ${a.token}`, "content-type": "application/json" };
    if (a.mode === "chatgpt" && a.accountId) headers["chatgpt-account-id"] = a.accountId;
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers,
      body,
    });
    const data = await res.json();
    if (res.ok) {
      data._auth = a.mode;
      return data;
    }
    lastErr = data?.error?.message || `mint ${res.status}`;
  }
  throw new Error(lastErr);
}

function keychain(service, account) {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

// The tools the realtime voice model may call. `set_prompt_box` is the ONE
// extra Secretary-View capability; `ask_the_agent` is the whole agent brain.
const VOICE_TOOLS = [
  {
    type: "function",
    name: "set_prompt_box",
    description:
      "Write, append to, or clear the text in the user's prompt input box in Secretary View. Use when the user asks you to draft, fill, edit, or clear what's in their box — e.g. 'put a message to the deploy bead in my box'.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["set", "append", "clear"], description: "set replaces, append adds, clear empties." },
        text: { type: "string", description: "The text (ignored for clear)." },
      },
      required: ["mode"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ask_the_agent",
    description:
      "Hand a request to the OpenHands agent to actually do or find out: inspect/manage the user's conversations and beads, run commands, look things up on this backend. Pass a clear instruction.",
    parameters: {
      type: "object",
      properties: { request: { type: "string" } },
      required: ["request"],
      additionalProperties: false,
    },
  },
];

// The extra phrase that tells the agent it is in Secretary View.
function secretaryContext() {
  return (
    "You are SmolPaws, the Secretary — a small, calm, lightly mischievous cat agent. " +
    "The human is looking at SECRETARY VIEW: a board of their projects (our epics), the beads in each, " +
    "and the conversations nested under each project, on this local OpenHands backend. " +
    "You can do everything the OpenHands agent can (inspect and manage conversations and beads, run commands, " +
    "find things on this backend) via ask_the_agent. In this view you have ONE extra ability: set_prompt_box, " +
    "which fills, appends to, or clears the text in the human's prompt input box. Keep spoken replies short and warm; never read raw JSON aloud."
  );
}

// --- http --------------------------------------------------------------------

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/api/board") {
    try {
      return send(res, 200, await buildBoard());
    } catch (e) {
      return send(res, 502, { error: String(e.message || e) });
    }
  }

  if (url.pathname === "/api/voice-config") {
    return send(res, 200, {
      model: REALTIME_MODEL,
      voice: VOICE,
      tools: VOICE_TOOLS,
      context: secretaryContext(),
      hasSubscription: Boolean(readChatgptAuth()),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/realtime/token") {
    try {
      return send(res, 200, await mintToken());
    } catch (e) {
      return send(res, 502, { error: String(e.message || e) });
    }
  }

  // Typed prompt box -> the agent brain.
  if (req.method === "POST" && url.pathname === "/api/ask") {
    const { request } = await readBody(req);
    const t0 = Date.now();
    try {
      const answer = await agentComplete(String(request || "").trim());
      return send(res, 200, { ok: true, ms: Date.now() - t0, answer });
    } catch (e) {
      return send(res, 502, { ok: false, error: String(e.message || e) });
    }
  }

  // Voice tool bridge: ask_the_agent runs the brain; set_prompt_box is handled
  // client-side (the browser owns the textarea), so it never reaches here.
  if (req.method === "POST" && url.pathname === "/api/agent/ask_the_agent") {
    const { request } = await readBody(req);
    const t0 = Date.now();
    try {
      const answer = await agentComplete(String(request || "").trim());
      return send(res, 200, { ok: true, ms: Date.now() - t0, result: { answer } });
    } catch (e) {
      return send(res, 502, { ok: false, error: String(e.message || e) });
    }
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const body = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    const type = file.endsWith(".js") ? "text/javascript" : "text/html";
    return send(res, 200, body, `${type}; charset=utf-8`);
  } catch {
    return send(res, 404, "not found", "text/plain");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[secretary] http://127.0.0.1:${PORT}/`);
  console.log(`[secretary] beads=${BEADS_JSONL}`);
  console.log(`[secretary] agent=${AGENT_BASE} key=${AGENT_KEY ? "yes" : "MISSING"}`);
  console.log(`[secretary] realtime auth=${readChatgptAuth() ? "ChatGPT subscription" : "api key/none"}`);
});
