// Secretary board — prototype v2 (smolpaws-s9e.1), self-referential demo.
//
// Engel's shape: split the board by PROJECT; in each project the TICKETS are
// OUR beads; and the conversations that belong to a project are shown inside it.
// The demo content is "this big round" — the three epics we're building right
// now — so the board is literally a picture of its own construction.
//
//   Project  = an epic bead (Insider / Voice / Secretary)
//   Ticket   = a child bead of that epic  (open/closed, priority)
//   Convo    = an agent-server conversation attributed to the project
//
// Read-only. Reads beads from the smolpaws repo JSONL and conversations from
// the local agent-server. Does not touch the live Purr Projects skin.
//
// Run:  PORT=4820 node server.mjs   then open http://127.0.0.1:4820/

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 4820);
const AGENT_BASE = process.env.AGENT_SERVER_URL || "http://127.0.0.1:18100";
const BEADS_JSONL =
  process.env.BEADS_JSONL ||
  join(homedir(), "repos", "smolpaws", ".beads", "issues.jsonl");

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

// The projects of "this big round" = the three epics, in build order.
const PROJECTS = [
  { id: "smolpaws-08f", key: "insider", name: "Insider Cat", blurb: "A SmolPaws living inside OpenHands" },
  { id: "smolpaws-3e1", key: "voice", name: "Realtime Voice", blurb: "Talk to the cat, it acts" },
  { id: "smolpaws-s9e", key: "secretary", name: "The Secretary", blurb: "The cat manages your conversations" },
];

function loadBeads() {
  const rows = [];
  try {
    const text = readFileSync(BEADS_JSONL, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    /* no beads file */
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

function shortModel(m) {
  if (!m) return null;
  return String(m).split("/").pop().replace(/^openhands_/, "");
}

// Attribute a conversation to a project. Today the only hard signal is the
// smolpaws=insider tag -> Insider. The rest are unattributed (honest: the link
// from a conversation to a project/ticket is exactly what the ticket store,
// s9e.3, will add). We surface them in an "unassigned" bucket so the gap shows.
function projectForConversation(c) {
  const tag = c.tags && c.tags.smolpaws;
  if (tag === "insider") return "smolpaws-08f";
  return null;
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
      updatedAt: c.updated_at || c.created_at || null,
    }));
  } catch (e) {
    convError = String(e.message || e);
  }

  const projects = PROJECTS.map((p) => {
    // Tickets = child beads of this epic (id starts with "<epic>.").
    const tickets = beads
      .filter((b) => b.id.startsWith(`${p.id}.`))
      .map((b) => ({
        id: b.id,
        title: b.title.replace(/^(insider|voice|secretary):\s*/i, ""),
        status: b.status,
        priority: b.priority,
        type: b.issue_type,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const convs = conversations.filter((c) => c.project === p.id);
    const epic = byId.get(p.id);
    const openCount = tickets.filter((t) => t.status !== "closed").length;
    const doneCount = tickets.filter((t) => t.status === "closed").length;
    return {
      ...p,
      epicTitle: epic ? epic.title : p.name,
      epicStatus: epic ? epic.status : "?",
      tickets,
      openCount,
      doneCount,
      conversations: convs,
    };
  });

  const unassigned = conversations.filter((c) => !c.project);

  return {
    generatedAt: new Date().toISOString(),
    beadsCount: beads.length,
    convError,
    projects,
    unassigned,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api/board") {
    try {
      const board = await buildBoard();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(board));
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const body = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    const type = file.endsWith(".js") ? "text/javascript" : "text/html";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    return res.end(body);
  } catch {
    res.writeHead(404);
    return res.end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[secretary-proto] http://127.0.0.1:${PORT}/`);
  console.log(`[secretary-proto] beads=${BEADS_JSONL}`);
  console.log(`[secretary-proto] agent=${AGENT_BASE} key=${AGENT_KEY ? "yes" : "MISSING"}`);
});
