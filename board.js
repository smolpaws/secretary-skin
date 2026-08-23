// Secretary board prototype — render real conversations into fixed columns.

const boardEl = document.getElementById("board");
const metaEl = document.getElementById("meta");
const footerEl = document.getElementById("footer");

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function cardHTML(c) {
  const model = c.model
    ? `<span class="chip model">${esc(c.model)}</span>`
    : "";
  const smol = c.tags && c.tags.smolpaws
    ? `<span class="chip tag">🐾 ${esc(c.tags.smolpaws)}</span>`
    : "";
  const action = c.action
    ? `<div class="action"><span class="pulse"></span>${esc(c.action)}</div>`
    : "";
  return `<div class="card">
    <div class="title"><span class="paw">🐾</span><span>${esc(c.title)}</span></div>
    ${action}
    <div class="foot">${model}${smol}<span class="id">${esc(String(c.id).slice(0, 8))}</span></div>
  </div>`;
}

function columnHTML(col) {
  const cards = col.cards.length
    ? col.cards.map(cardHTML).join("")
    : `<div class="empty">—</div>`;
  return `<section class="col" data-col="${col.id}">
    <div class="head"><span class="dot"></span><span class="name">${esc(col.label)}</span><span class="n">${col.cards.length}</span></div>
    <div class="body">${cards}</div>
  </section>`;
}

async function load() {
  metaEl.textContent = "refreshing…";
  try {
    const r = await fetch("/api/board");
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    boardEl.innerHTML = d.columns.map(columnHTML).join("");
    metaEl.textContent = `${d.total} conversations · ${new Date(d.generatedAt).toLocaleTimeString()}`;
    footerEl.innerHTML =
      "Reading real conversations from the local agent-server · read-only · layout prototype for smolpaws-s9e.1";
  } catch (e) {
    metaEl.textContent = "error";
    footerEl.innerHTML = `<span class="err">${esc(e.message || e)}</span>`;
  }
}

document.getElementById("refresh").addEventListener("click", load);
load();
