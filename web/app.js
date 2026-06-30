// FairFit frontend

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ACCEPTED = new Set(["txt", "md", "text"]);
const state = { samples: new Set(), uploads: [] };
const byId = {};
let criteriaTitle = "the role";

const runBtn = $("#run-btn"), hint = $("#input-hint"), fileInput = $("#file-input"), dropzone = $("#dropzone");
const extOf = (n) => (n.toLowerCase().split(".").pop() || "");

function selectedCount() { return state.samples.size + state.uploads.length; }
function updateRun() {
  const c = selectedCount();
  $("#sel-count").textContent = c ? `${c} candidate${c > 1 ? "s" : ""} selected` : "";
  runBtn.disabled = !($("#brief").value.trim() && c);
  hint.textContent = "";
}
$("#brief").addEventListener("input", updateRun);

// roles
async function loadRoles() {
  try {
    const roles = await (await fetch("/api/roles")).json();
    const box = $("#role-chips");
    roles.forEach((r) => {
      const chip = el("button", "chip"); chip.textContent = r.name;
      chip.onclick = () => {
        const was = chip.classList.contains("active");
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        if (was) { $("#brief").value = ""; } else { chip.classList.add("active"); $("#brief").value = r.brief || ""; }
        updateRun();
      };
      box.appendChild(chip);
    });
  } catch (e) {}
}

// cv list
async function loadCvs() {
  let cvs = [];
  try { cvs = await (await fetch("/api/cvs")).json(); } catch (e) { return; }
  const list = $("#cv-list");
  list.innerHTML = "";
  cvs.forEach((c) => {
    const row = el("li", "cv-row");
    row.dataset.id = c.id;
    row.innerHTML = `<input type="checkbox"><div><div class="cv-name">${esc(c.name)}</div></div><div class="cv-head">${esc(c.headline)}</div>`;
    const cb = row.querySelector("input");
    const toggle = (on) => { cb.checked = on; row.classList.toggle("sel", on); if (on) state.samples.add(c.id); else state.samples.delete(c.id); updateRun(); };
    row.onclick = (e) => { toggle(e.target === cb ? cb.checked : !cb.checked); };
    list.appendChild(row);
  });
}
$("#select-all").onchange = (e) => {
  const on = e.target.checked;
  state.samples = new Set();
  document.querySelectorAll(".cv-row").forEach((row) => {
    row.classList.toggle("sel", on);
    row.querySelector("input").checked = on;
    if (on) state.samples.add(row.dataset.id);
  });
  updateRun();
};

// uploads
function renderUploads() {
  const ul = $("#upload-list"); ul.innerHTML = "";
  state.uploads.forEach((f, i) => {
    const li = el("li", null, `${icon("i-upload")}<span>${esc(f.name)}</span><button class="fl-x">&times;</button>`);
    li.querySelector(".fl-x").onclick = () => { state.uploads.splice(i, 1); renderUploads(); updateRun(); };
    ul.appendChild(li);
  });
}
function addFiles(list) {
  const warn = [];
  for (const f of list) {
    if (!ACCEPTED.has(extOf(f.name))) { warn.push(`${f.name}: unsupported`); continue; }
    if (state.uploads.some((x) => x.name === f.name && x.size === f.size)) continue;
    state.uploads.push(f);
  }
  renderUploads(); updateRun();
  if (warn.length) hint.textContent = "Skipped — " + warn.join("; ");
}
dropzone.onclick = () => fileInput.click();
dropzone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

// run
runBtn.onclick = () => {
  const fd = new FormData();
  fd.append("brief", $("#brief").value || "");
  fd.append("cvs", Array.from(state.samples).join(","));
  state.uploads.forEach((f) => fd.append("files", f, f.name));

  $("#setup").classList.add("hidden");
  document.querySelector(".run-row").classList.add("hidden");
  $("#board").classList.remove("hidden");
  $("#criteria").innerHTML = "";
  ["favorable", "medium", "unfavorable"].forEach((t) => { $("#col-" + t).innerHTML = ""; $("#count-" + t).textContent = "0"; });
  $("#run-status").textContent = "Starting screening...";
  $("#reset-row").classList.add("hidden");
  $("#board").scrollIntoView({ behavior: "smooth", block: "start" });

  let screened = 0;
  (async () => {
    let job;
    try { job = await (await fetch("/api/process", { method: "POST", body: fd })).json(); }
    catch (e) { return showError("Could not reach the server."); }
    if (!job || !job.job_id) return showError("The server did not start a job.");
    let done = false;
    const es = new EventSource("/api/events/" + job.job_id);
    es.onmessage = (msg) => {
      let ev; try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.type === "progress") $("#run-status").textContent = ev.status;
      else if (ev.type === "candidate") { screened++; $("#run-status").textContent = `Screened ${screened}: ${ev.data.name} (${ev.data.tier})`; }
      else if (ev.type === "result") { done = true; es.close(); render(ev.data); }
      else if (ev.type === "error") { done = true; es.close(); showError(ev.message); }
    };
    es.onerror = () => { es.close(); if (!done) showError("Lost connection during screening. Please retry."); };
  })();
};

function showError(message) {
  $("#run-status").textContent = "";
  $("#criteria").innerHTML = `<h3>${icon("i-alert")} Screening failed</h3><p class="c-sum">${esc(message)}</p><p class="c-sum">Confirm OPENAI_API_KEY is set in .env, then retry.</p>`;
  $("#reset-row").classList.remove("hidden");
}

function render(d) {
  $("#run-status").textContent = "";
  const cr = d.criteria || {};
  criteriaTitle = cr.title || "the role";
  $("#criteria").innerHTML = `<h3>${esc(cr.title || "Role")}</h3>
    <p class="c-sum">${esc(cr.summary || "")}</p>
    ${(cr.must_haves || []).length ? `<p class="subhead">Must-haves</p><div class="tagrow">${cr.must_haves.map((x) => `<span class="tag must">${esc(x)}</span>`).join("")}</div>` : ""}
    ${(cr.nice_to_haves || []).length ? `<p class="subhead">Nice-to-haves</p><div class="tagrow">${cr.nice_to_haves.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}`;

  const counts = { favorable: 0, medium: 0, unfavorable: 0 };
  (d.candidates || []).forEach((c) => {
    byId[c.id] = c;
    const tier = ["favorable", "medium", "unfavorable"].includes(c.tier) ? c.tier : "medium";
    counts[tier]++;
    $("#col-" + tier).appendChild(card(c, tier));
  });
  ["favorable", "medium", "unfavorable"].forEach((t) => {
    $("#count-" + t).textContent = counts[t];
    if (!counts[t]) $("#col-" + t).appendChild(el("div", "col-empty", "No candidates."));
  });
  $("#reset-row").classList.remove("hidden");
}

function card(c, tier) {
  const node = el("div", "cand");
  const matched = (c.matched || []).slice(0, 4).map((m) => `<span class="mini ok">${esc(m)}</span>`).join("");
  const missing = (c.missing || []).slice(0, 4).map((m) => `<span class="mini no">${esc(m)}</span>`).join("");
  node.innerHTML = `<div class="c-top"><span class="c-name">${esc(c.name)}</span><span class="c-score">${c.score != null ? c.score + "/100" : ""}</span></div>
    <div class="c-headline">${esc(c.headline || "")}</div>
    <p class="c-reason">${esc(c.reason || "")}</p>
    ${matched || missing ? `<div class="c-chips">${matched}${missing}</div>` : ""}
    <div class="c-actions"><button class="btn-mini view">${icon("i-eye")} View CV</button><button class="btn-mini email">${icon("i-mail")} Draft email</button></div>`;
  node.querySelector(".view").onclick = () => openCV(c);
  node.querySelector(".email").onclick = () => openEmail(c, tier);
  return node;
}

function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
$("#modal-x").onclick = () => $("#modal").classList.add("hidden");
$("#modal").onclick = (e) => { if (e.target === $("#modal")) $("#modal").classList.add("hidden"); };

function openCV(c) {
  openModal(`<h3>${esc(c.name)}</h3><p class="m-sub">${esc(c.headline || "")}</p><div class="cv-text">${esc(c.cv_text || "")}</div>`);
}

const KIND = { favorable: "invite", medium: "info", unfavorable: "rejection" };
const KIND_LABEL = { invite: "Interview invite", info: "Request more info", rejection: "Kind rejection" };
async function openEmail(c, tier) {
  const kind = KIND[tier] || "info";
  openModal(`<h3>${KIND_LABEL[kind]}</h3><p class="m-sub">${esc(c.name)} · ${esc(criteriaTitle)}</p><p class="c-sum"><span class="spinner"></span> Drafting...</p>`);
  try {
    const d = await (await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role_title: criteriaTitle, candidate_name: c.name, cv_excerpt: c.cv_text || "", kind }) })).json();
    if (d.error) { $("#modal-body").innerHTML = `<h3>${KIND_LABEL[kind]}</h3><p class="c-sum">${esc(d.error)}</p>`; return; }
    openModal(`<h3>${KIND_LABEL[kind]}</h3><p class="m-sub">To ${esc(c.name)}</p>
      <div class="email-box"><div class="email-subj">${esc(d.subject || "")}</div>${esc(d.message || "")}</div>
      <div style="margin-top:12px"><button class="btn-ghost" id="copy-email">Copy</button></div>`);
    $("#copy-email").onclick = () => navigator.clipboard && navigator.clipboard.writeText((d.subject ? d.subject + "\n\n" : "") + (d.message || ""));
  } catch (e) { $("#modal-body").innerHTML = `<h3>${KIND_LABEL[kind]}</h3><p class="c-sum">Could not draft the email. Please retry.</p>`; }
}

// reset
$("#reset-btn").onclick = () => {
  $("#board").classList.add("hidden"); $("#reset-row").classList.add("hidden");
  $("#setup").classList.remove("hidden"); document.querySelector(".run-row").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

loadRoles();
loadCvs();
updateRun();

/* ============================================================
   Bring-your-own OpenAI key (for public / self-hosted demo).
   Adds a top-bar button; stores the key in localStorage and
   sends it as X-OpenAI-Key on every /api/ request. The server
   uses it if present, otherwise falls back to its .env key.
   ============================================================ */
(function () {
  var KEY = "OPENAI_KEY";
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    var k = localStorage.getItem(KEY);
    if (k && typeof url === "string" && url.indexOf("/api/") === 0) {
      opts = Object.assign({}, opts);
      opts.headers = Object.assign({}, opts.headers || {}, { "X-OpenAI-Key": k });
    }
    return _fetch(url, opts);
  };

  var ACC = "var(--accent, var(--teal, var(--accent-deep, #2563eb)))";
  var CARD = "var(--card, var(--panel, var(--paper, #ffffff)))";
  var INK = "var(--ink, #1a1a1a)";
  var LINE = "var(--line, #dddddd)";
  var MUTED = "var(--muted, var(--slate, var(--muted-ink, #888888)))";
  var css =
    ".kk-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid " + LINE + ";background:" + CARD + ";color:" + INK + ";font:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px;cursor:pointer}" +
    ".kk-btn:hover{border-color:" + ACC + "}" +
    ".kk-dot{width:8px;height:8px;border-radius:50%;background:#d9a33a}" +
    ".kk-dot.on{background:#2aa676}" +
    ".kk-ov{position:fixed;inset:0;background:rgba(10,15,20,.55);display:grid;place-items:center;z-index:99999;padding:20px}" +
    ".kk-card{background:" + CARD + ";color:" + INK + ";border:1px solid " + LINE + ";border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);font-family:inherit}" +
    ".kk-card h4{margin:0 0 6px;font-size:18px}" +
    ".kk-card p{margin:0 0 14px;font-size:13px;color:" + MUTED + "}" +
    ".kk-card input{width:100%;box-sizing:border-box;border:1px solid " + LINE + ";border-radius:10px;padding:11px 13px;font:inherit;font-size:14px;background:" + CARD + ";color:" + INK + "}" +
    ".kk-card input:focus{outline:none;border-color:" + ACC + "}" +
    ".kk-row{display:flex;gap:10px;margin-top:14px}" +
    ".kk-save{flex:1;border:none;cursor:pointer;background:" + ACC + ";color:#fff;border-radius:10px;padding:11px;font:inherit;font-weight:600}" +
    ".kk-clear{border:1px solid " + LINE + ";background:transparent;color:" + INK + ";border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit;font-weight:600}" +
    ".kk-note{margin-top:12px;font-size:11.5px;color:" + MUTED + ";line-height:1.5}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement("button");
  btn.className = "kk-btn";
  btn.type = "button";
  function refresh() {
    var has = !!localStorage.getItem(KEY);
    btn.innerHTML = '<span class="kk-dot' + (has ? " on" : "") + '"></span>' + (has ? "API key set" : "Add API key");
  }
  function mount() {
    var h = document.querySelector(".nav-inner") || document.querySelector(".topbar");
    if (!h) {
      btn.style.position = "fixed"; btn.style.top = "14px"; btn.style.right = "16px"; btn.style.zIndex = "9998";
      document.body.appendChild(btn);
    } else {
      h.appendChild(btn);
    }
    refresh();
  }
  btn.onclick = function () {
    var ov = document.createElement("div"); ov.className = "kk-ov";
    var cur = localStorage.getItem(KEY) || "";
    var card = document.createElement("div"); card.className = "kk-card";
    card.innerHTML =
      "<h4>OpenAI API key</h4>" +
      "<p>Use your own key to run this demo. It is stored only in this browser and sent to your local server with each request.</p>" +
      '<input type="password" class="kk-in" placeholder="sk-..." autocomplete="off">' +
      '<div class="kk-row"><button class="kk-save" type="button">Save</button><button class="kk-clear" type="button">Clear</button></div>' +
      '<div class="kk-note">Stored in your browser (localStorage) on this device only. Never commit your key to the repo. If you leave this empty, the server uses its own .env key.</div>';
    ov.appendChild(card);
    card.querySelector(".kk-in").value = cur;
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    card.querySelector(".kk-save").onclick = function () {
      var v = card.querySelector(".kk-in").value.trim();
      if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
      refresh(); ov.remove();
    };
    card.querySelector(".kk-clear").onclick = function () { localStorage.removeItem(KEY); refresh(); ov.remove(); };
    document.body.appendChild(ov);
    card.querySelector(".kk-in").focus();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
