// Secretary board — prototype (smolpaws-s9e.1).
//
// A throwaway prototype to settle the FIXED board layout before we wire the
// real ticket store + dispatch. It reads REAL conversations from the local
// agent-server and lays them out as cards in state columns, so we can look at
// the layout with live data instead of mockups.
//
// This does NOT modify the live Purr Projects skin; it's a separate proto dir.
// Read-only against the agent-server.
//
// Run:  node server.mjs   then open http://127.0.0.1:4820/

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 4820);
const AGENT_BASE = process.env.AGENT_SERVER_URL || "http://127.0.0.1:18100";
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

// The fixed columns. Until tickets exist, a conversation's execution_status
// maps to a column; once tickets land these become the ticket lifecycle
// (pending / in_progress / needs_input / done).
const COLUMNS = [
  { id: "in_progress", label: "In progress", statuses: ["running", "executing", "busy"] },
  { id: "needs_input", label: "Needs input", statuses: ["waiting_for_confirmation", "paused", "stuck", "error"] },
  { id: "idle", label: "Idle", statuses: ["idle", "unknown", null] },
  { id: "done", label: "Done", statuses: ["finished", "completed", "stopped"] },
];

function columnFor(status) {
  const s = (status || "idle").toLowerCase();
  for (const c of COLUMNS) if (c.statuses.includes(s)) return c.id;
  return "idle";
}

async function agentGet(path) {
  const res = await fetch(`${AGENT_BASE}${path}`, {
    headers: AGENT_KEY ? { "X-Session-API-Key": AGENT_KEY } : {},
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// Latest agent action summary for a conversation — the "alive" line on a card.
// The LLM-predicted summary rides in an ActionEvent's tool_call arguments.
async function latestAction(id) {
  try {
    const d = await agentGet(
      `/api/conversations/${encodeURIComponent(id)}/events/search?limit=10`,
    );
    for (const it of d.items || []) {
      const tc = it.action?.tool_call || it.tool_call;
      const args = tc?.arguments;
      if (typeof args === "string") {
        try {
          const j = JSON.parse(args);
          if (j.summary) return j.summary;
        } catch {
          /* not json */
        }
      }
      if (it.action?.kind) return it.action.kind;
    }
  } catch {
    /* best effort */
  }
  return null;
}

function shortModel(m) {
  if (!m) return null;
  return String(m).split("/").pop().replace(/^openhands_/, "");
}

async function buildBoard() {
  const d = await agentGet("/api/conversations/search?limit=40");
  const items = d.items || [];
  // Only enrich the few non-idle ones with a live action (keep it snappy).
  const cards = await Promise.all(
    items.map(async (c) => {
      const col = columnFor(c.execution_status);
      const action = col === "in_progress" ? await latestAction(c.id) : null;
      return {
        id: c.id,
        title: c.title || `conversation ${String(c.id).slice(0, 8)}`,
        status: c.execution_status || "idle",
        column: col,
        model: shortModel(c.current_model_id || c.agent?.llm?.model),
        tags: c.tags || {},
        updatedAt: c.updated_at || c.created_at || null,
        action,
      };
    }),
  );
  const columns = COLUMNS.map((col) => ({
    ...col,
    cards: cards
      .filter((c) => c.column === col.id)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
  }));
  return { generatedAt: new Date().toISOString(), total: cards.length, columns };
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
  console.log(`[secretary-proto] agent=${AGENT_BASE} key=${AGENT_KEY ? "yes" : "MISSING"}`);
});
