// The Secretary — board render + prompt box (typed) + realtime voice (cat click).

const REPO = "smolpaws";
const el = (id) => document.getElementById(id);
const boardEl = el("board");
const metaEl = el("meta");
const footerEl = el("footer");
const promptEl = el("prompt");
const answerEl = el("answer");
const answerBody = el("answerBody");
const vstatusEl = el("vstatus");
const catEl = el("cat");

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

// ---- realtime voice (cat click) ------------------------------------------

let pc = null;
let dc = null;
let micStream = null;
let voiceCfg = null;

function vstatus(text, kind = "") {
  vstatusEl.textContent = text;
  vstatusEl.className = `vstatus ${kind}`;
}

async function startVoice() {
  catEl.classList.add("live");
  vstatus("🎙 connecting…");
  try {
    voiceCfg = await (await fetch("api/voice-config")).json();
    const token = await (await fetch("api/realtime/token", { method: "POST" })).json();
    if (token.error) throw new Error(token.error);

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = (e) => (audio.srcObject = e.streams[0]);
    micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

    dc = pc.createDataChannel("oai-events");
    dc.onopen = () => {
      vstatus("🎙 listening — talk to the cat", "live");
      // Seed the cat with whatever is already in the box (e.g. from a bead
      // click) so it starts the conversation aware of the in-progress text,
      // and can still re-read it live via get_prompt_box.
      const box = promptEl.value.trim();
      const instructions =
        voiceCfg.context +
        (box
          ? `\n\nRight now the human's prompt box already contains this in-progress text:\n"""\n${box}\n"""`
          : "\n\nRight now the human's prompt box is empty.");
      dc.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            instructions,
            tools: voiceCfg.tools,
            tool_choice: "auto",
          },
        }),
      );
    };
    dc.onmessage = (e) => handleVoiceEvent(JSON.parse(e.data));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = await fetch(
      `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(voiceCfg.model)}`,
      {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
      },
    );
    if (!sdp.ok) throw new Error(`SDP ${sdp.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
  } catch (e) {
    vstatus(`voice error: ${e.message || e}`, "err");
    stopVoice();
  }
}

function stopVoice() {
  catEl.classList.remove("live");
  if (dc) try { dc.close(); } catch {}
  if (pc) try { pc.close(); } catch {}
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  pc = dc = micStream = null;
  if (!vstatusEl.classList.contains("err")) vstatus("🎙 click the cat to talk");
}

async function handleVoiceEvent(ev) {
  if (ev.type === "response.function_call_arguments.done") {
    let args = {};
    try {
      args = ev.arguments ? JSON.parse(ev.arguments) : {};
    } catch {}
    let output;
    if (ev.name === "get_prompt_box") {
      // Read the live textarea — browser owns it.
      const box = promptEl.value;
      output = { box, empty: box.trim() === "" };
    } else if (ev.name === "set_prompt_box") {
      // The extra Secretary-View capability — browser owns the textarea.
      if (args.mode === "clear") setPrompt("");
      else if (args.mode === "append") setPrompt(promptEl.value + (args.text || ""));
      else setPrompt(args.text || "");
      output = { ok: true, box: promptEl.value };
    } else if (ev.name === "ask_the_agent") {
      showAnswer("", true);
      try {
        const d = await (
          await fetch("api/agent/ask_the_agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(args),
          })
        ).json();
        if (d.ok) {
          showAnswer(d.result.answer, false);
          output = d.result;
        } else output = { error: d.error };
      } catch (e) {
        output = { error: String(e.message || e) };
      }
    } else {
      output = { error: `unknown tool ${ev.name}` };
    }
    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(output) },
      }),
    );
    dc.send(JSON.stringify({ type: "response.create" }));
  }
}

catEl.addEventListener("click", () => {
  if (pc) stopVoice();
  else startVoice();
});

// ---- go -------------------------------------------------------------------
el("refresh").addEventListener("click", loadBoard);
loadBoard();
