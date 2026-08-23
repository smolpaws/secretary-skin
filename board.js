// Secretary board prototype — project lanes; tickets = beads; convos nested.

const boardEl = document.getElementById("board");
const metaEl = document.getElementById("meta");
const footerEl = document.getElementById("footer");

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function ticketHTML(t) {
  const closed = t.status === "closed";
  const prio =
    t.priority === 0 ? "p0" : t.priority === 1 ? "p1" : "";
  return `<div class="ticket ${closed ? "closed" : ""}">
    <span class="box"></span>
    <div>
      <div class="tt">${esc(t.title)}</div>
      <div class="tmeta">
        <span class="prio ${prio}">P${t.priority}</span>
        <span class="tid">${esc(t.id)}</span>
      </div>
    </div>
  </div>`;
}

function convHTML(c) {
  const st = (c.status || "idle").toLowerCase();
  const cls = ["running", "executing", "busy"].includes(st)
    ? "running"
    : ["finished", "completed", "stopped"].includes(st)
      ? "finished"
      : "idle";
  return `<div class="conv">
    <span class="dot ${cls}"></span>
    <span class="ct">${esc(c.title)}</span>
    ${c.model ? `<span class="cm">${esc(c.model)}</span>` : ""}
    <span class="cid">${esc(String(c.id).slice(0, 8))}</span>
  </div>`;
}

function laneHTML(p) {
  const total = p.tickets.length || 1;
  const pct = Math.round((p.doneCount / total) * 100);
  const tickets = p.tickets.length
    ? p.tickets.map(ticketHTML).join("")
    : `<div class="none">no tickets</div>`;
  const convs = p.conversations.length
    ? p.conversations.map(convHTML).join("")
    : `<div class="none">no conversations linked yet</div>`;
  return `<section class="lane">
    <div class="head">
      <div class="pname">${esc(p.name)} <span class="id">${esc(p.id)}</span></div>
      <div class="blurb">${esc(p.blurb)}</div>
      <div class="bars">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <span class="counts">${p.doneCount} done · ${p.openCount} open</span>
      </div>
    </div>
    <div class="section">
      <h4>Tickets · our beads</h4>
      ${tickets}
    </div>
    <div class="section convs">
      <h4>Conversations · ${p.conversations.length}</h4>
      ${convs}
    </div>
  </section>`;
}

async function load() {
  metaEl.textContent = "refreshing…";
  try {
    const r = await fetch("/api/board");
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    boardEl.innerHTML = d.projects.map(laneHTML).join("");
    const conv = d.projects.reduce((n, p) => n + p.conversations.length, 0);
    metaEl.textContent = `${d.beadsCount} beads · ${conv} linked convs · ${d.unassigned.length} unassigned · ${new Date(d.generatedAt).toLocaleTimeString()}`;
    footerEl.innerHTML = d.convError
      ? `<span class="err">agent-server: ${esc(d.convError)}</span>`
      : "Projects = our epics · tickets = our beads · conversations nested per project · read-only · smolpaws-s9e.1";
  } catch (e) {
    metaEl.textContent = "error";
    footerEl.innerHTML = `<span class="err">${esc(e.message || e)}</span>`;
  }
}

document.getElementById("refresh").addEventListener("click", load);
load();
