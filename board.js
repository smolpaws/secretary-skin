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

// ---- board render ---------------------------------------------------------

function beadHTML(t) {
  const closed = t.status === "closed";
  const prio = t.priority === 0 ? "p0" : t.priority === 1 ? "p1" : "";
  return `<div class="bead ${closed ? "closed" : ""}" data-id="${esc(t.id)}" data-title="${esc(t.title)}">
    <span class="box"></span>
    <div>
      <div class="tt">${esc(t.title)}</div>
      <div class="tmeta"><span class="prio ${prio}">P${t.priority}</span><span class="tid">${esc(t.id)}</span></div>
    </div>
  </div>`;
}

let CANVAS_UI = "http://127.0.0.1:12000";

function convHTML(c) {
  const st = (c.status || "idle").toLowerCase();
  const cls = ["running", "executing", "busy"].includes(st)
    ? "running"
    : ["finished", "completed", "stopped"].includes(st)
      ? "finished"
      : "idle";
  const href = `${CANVAS_UI}/conversations/${encodeURIComponent(c.id)}`;
  return `<a class="conv" href="${esc(href)}" target="_blank" rel="noopener" title="Open in Canvas"><span class="dot ${cls}"></span><span class="ct">${esc(c.title)}</span>${c.model ? `<span class="cm">${esc(c.model)}</span>` : ""}<span class="cid">${esc(String(c.id).slice(0, 8))}</span></a>`;
}

function laneHTML(p) {
  const total = p.beads.length || 1;
  const pct = Math.round((p.doneCount / total) * 100);
  const beads = p.beads.length ? p.beads.map(beadHTML).join("") : `<div class="none">no beads</div>`;
  const convs = p.conversations.length
    ? p.conversations.map(convHTML).join("")
    : `<div class="none">no conversations linked yet</div>`;
  return `<section class="lane">
    <div class="head">
      <div class="pname">${esc(p.name)} <span class="id">${esc(p.id)}</span></div>
      <div class="blurb">${esc(p.blurb)}</div>
      <div class="bars"><div class="bar"><span style="width:${pct}%"></span></div><span class="counts">${p.doneCount} done · ${p.openCount} open</span></div>
    </div>
    <div class="section"><h4>Beads</h4>${beads}</div>
    <div class="section convs"><h4>Conversations · ${p.conversations.length}</h4>${convs}</div>
  </section>`;
}

async function loadBoard() {
  metaEl.textContent = "refreshing…";
  try {
    const d = await (await fetch("/api/board")).json();
    if (d.error) throw new Error(d.error);
    if (d.canvasUiUrl) CANVAS_UI = d.canvasUiUrl;
    boardEl.innerHTML = d.projects.map(laneHTML).join("");
    const conv = d.projects.reduce((n, p) => n + p.conversations.length, 0);
    metaEl.textContent = `${d.beadsCount} beads · ${conv} linked · ${d.unassigned.length} unassigned`;
  } catch (e) {
    metaEl.textContent = "error";
    footerEl.innerHTML = `<span class="err">${esc(e.message || e)}</span>`;
  }
}

// Click a bead -> seed the prompt box, waiting for the human to write more.
boardEl.addEventListener("click", (ev) => {
  const bead = ev.target.closest(".bead");
  if (!bead) return;
  const id = bead.getAttribute("data-id");
  const title = bead.getAttribute("data-title");
  setPrompt(`We are working on bead ${id} from repo ${REPO}: ${title}\n\n`);
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
      await fetch("/api/ask", {
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
    voiceCfg = await (await fetch("/api/voice-config")).json();
    const token = await (await fetch("/api/realtime/token", { method: "POST" })).json();
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
      dc.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: voiceCfg.context,
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
    if (ev.name === "set_prompt_box") {
      // The ONE extra Secretary-View capability — browser owns the textarea.
      if (args.mode === "clear") setPrompt("");
      else if (args.mode === "append") setPrompt(promptEl.value + (args.text || ""));
      else setPrompt(args.text || "");
      output = { ok: true, box: promptEl.value };
    } else if (ev.name === "ask_the_agent") {
      showAnswer("", true);
      try {
        const d = await (
          await fetch("/api/agent/ask_the_agent", {
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
