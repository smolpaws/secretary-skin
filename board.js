// The Secretary — board render + prompt box (typed). Voice now lives in the
// insider-cat overlay in Canvas, not here.

const REPO = "smolpaws";
const el = (id) => document.getElementById(id);
const boardEl = el("board");
const metaEl = el("meta");
const footerEl = el("footer");
const promptEl = el("prompt");
const answerEl = el("answer");
const answerBody = el("answerBody");

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// ---- board render (fixed four-column state kanban, smolpaws-s9e.1) --------

let CANVAS_UI = "http://127.0.0.1:12000";

// The four deliberate columns. Each maps a set of raw agent-server execution
// states to one lane. Order left→right = the natural life of a conversation.
const COLUMNS = [
  { key: "pending", name: "Pending", cls: "pending", states: ["idle", "created", "queued", "pending", "ready"] },
  { key: "progress", name: "In progress", cls: "progress", states: ["running", "executing", "busy", "in_progress", "working"] },
  { key: "input", name: "Needs input", cls: "input", states: ["paused", "waiting", "awaiting", "stopped", "error", "failed", "blocked"] },
  { key: "done", name: "Done", cls: "done", states: ["finished", "completed", "done", "succeeded"] },
];

function columnFor(status) {
  const st = String(status || "idle").toLowerCase();
  const col = COLUMNS.find((c) => c.states.includes(st));
  return col ? col.key : "input"; // unknown states surface as "needs input"
}

function cardHTML(c) {
  const colKey = columnFor(c.status);
  const st = String(c.status || "idle").toLowerCase();
  const href = `${CANVAS_UI}/conversations/${encodeURIComponent(c.id)}`;
  const proj = c.projectName
    ? `<span class="chip proj">${esc(c.projectName)}</span>`
    : "";
  const model = c.model ? `<span class="chip model">${esc(c.model)}</span>` : "";
  return `<div class="card" data-id="${esc(c.id)}" data-title="${esc(c.title)}" data-href="${esc(href)}">
    <div class="ctitle">${esc(c.title)}</div>
    <div class="crow">
      <span class="chip state st-${colKey}"><span class="sd"></span>${esc(st)}</span>
      ${proj}${model}
    </div>
    <div class="crow">
      <span class="cid">${esc(String(c.id).slice(0, 8))}</span>
      <a class="clink" href="${esc(href)}" target="_blank" rel="noopener">open ↗</a>
    </div>
  </div>`;
}

function columnHTML(col, cards) {
  const body = cards.length
    ? cards.map(cardHTML).join("")
    : `<div class="none">nothing here</div>`;
  return `<section class="col ${col.cls}">
    <div class="chead"><span class="cdot"></span><span class="cname">${esc(col.name)}</span><span class="ccount">${cards.length}</span></div>
    <div class="cbody">${body}</div>
  </section>`;
}

// Flatten every conversation (project-tagged + unassigned) into one list, then
// bucket by state column. The project name rides along as a chip on the card.
function allConversations(d) {
  const out = [];
  for (const p of d.projects || []) {
    for (const c of p.conversations || []) out.push({ ...c, projectName: p.name });
  }
  for (const c of d.unassigned || []) out.push({ ...c, projectName: null });
  return out;
}

async function loadBoard() {
  metaEl.textContent = "refreshing…";
  try {
    const d = await (await fetch("api/board")).json();
    if (d.error) throw new Error(d.error);
    if (d.canvasUiUrl) CANVAS_UI = d.canvasUiUrl;
    const convs = allConversations(d);
    const buckets = { pending: [], progress: [], input: [], done: [] };
    for (const c of convs) buckets[columnFor(c.status)].push(c);
    boardEl.innerHTML = COLUMNS.map((col) => columnHTML(col, buckets[col.key])).join("");
    metaEl.textContent = `${convs.length} conversations · ${buckets.progress.length} in progress · ${buckets.input.length} need input`;
  } catch (e) {
    metaEl.textContent = "error";
    footerEl.innerHTML = `<span class="err">${esc(e.message || e)}</span>`;
  }
}

// Click a card -> seed the prompt box about that conversation, waiting for the
// human to write more. Clicking the "open ↗" link is not intercepted.
boardEl.addEventListener("click", (ev) => {
  if (ev.target.closest(".clink")) return;
  const card = ev.target.closest(".card");
  if (!card) return;
  const id = card.getAttribute("data-id");
  const title = card.getAttribute("data-title");
  setPrompt(`About conversation "${title}" (${String(id).slice(0, 8)}):\n\n`);
  promptEl.focus();
  promptEl.selectionStart = promptEl.selectionEnd = promptEl.value.length;
});

// ---- prompt box (typed path) ---------------------------------------------

function setPrompt(text) {
  promptEl.value = text;
  autogrow();
}
function autogrow() {
  promptEl.style.height = "auto";
  promptEl.style.height = Math.min(promptEl.scrollHeight, 160) + "px";
}
promptEl.addEventListener("input", autogrow);

function showAnswer(text, thinking) {
  answerEl.classList.add("show");
  answerEl.classList.toggle("think", !!thinking);
  answerBody.textContent = text;
}

async function submitPrompt() {
  const request = promptEl.value.trim();
  if (!request) return;
  el("send").disabled = true;
  showAnswer("", true);
  try {
    const d = await (
      await fetch("api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request }),
      })
    ).json();
    if (d.ok) showAnswer(d.answer, false);
    else showAnswer(`error: ${d.error}`, false);
  } catch (e) {
    showAnswer(`error: ${e.message || e}`, false);
  } finally {
    el("send").disabled = false;
  }
}

el("send").addEventListener("click", submitPrompt);
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitPrompt();
  }
});

// ---- prompt-box bridge (voice, from the Canvas overlay) -------------------
//
// The realtime voice cat lives in the persistent Canvas overlay, not here. The
// board is loaded as a same-origin iframe under /skin. When the voice model
// wants to read or write the human's prompt box, the overlay posts a message to
// this iframe and we answer on the same channel. Keeping the contract here (not
// reaching into our DOM from outside) survives the skin ever going cross-origin.
//
// Protocol: overlay -> { source: "smolpaws-voice", id, command, mode?, text? }
//           board   -> { source: "smolpaws-board", id, ok, value? , error? }
window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || msg.source !== "smolpaws-voice" || !msg.id) return;
  const reply = (payload) =>
    ev.source?.postMessage(
      { source: "smolpaws-board", id: msg.id, ...payload },
      ev.origin === "null" ? "*" : ev.origin,
    );
  try {
    if (msg.command === "read_prompt_box") {
      return reply({ ok: true, value: promptEl.value });
    }
    if (msg.command === "write_prompt_box") {
      if (msg.mode === "clear") setPrompt("");
      else if (msg.mode === "append") setPrompt(promptEl.value + String(msg.text || ""));
      else setPrompt(String(msg.text || "")); // "set" (default)
      promptEl.focus();
      return reply({ ok: true, value: promptEl.value });
    }
    return reply({ ok: false, error: `unknown command: ${msg.command}` });
  } catch (e) {
    return reply({ ok: false, error: String(e.message || e) });
  }
});

// ---- go -------------------------------------------------------------------
el("refresh").addEventListener("click", loadBoard);
loadBoard();
