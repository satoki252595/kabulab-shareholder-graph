const KIND_COLOR = {
  corp: "#0c5552",
  inst: "#2a4a66",
  foreign: "#2a4a66",
  person: "#7a5424",
  employee: "#7a5424",
  insurer: "#7a5424",
  broker: "#5d6b73",
};
const KIND_LABEL = {
  corp: "事業会社",
  inst: "機関",
  foreign: "海外機関",
  person: "個人",
  employee: "持株会",
  insurer: "保険",
  broker: "証券",
};

const state = {
  data: null,
  by: new Map(),
  mode: "ego",
  focus: "9435",
  hover: null,
  suggest: 0,
  matches: [],
  cam: { x: 0, y: 0, k: 1 },
  drag: null,
};

const canvas = document.querySelector("#graph");
const ctx = canvas.getContext("2d");
const q = document.querySelector("#q");
const suggest = document.querySelector("#suggest");

function pct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = Math.round(n * 10) / 10;
  return `${v.toFixed(1)}%`;
}

function signed(n) {
  if (n === null || n === undefined) return "";
  const v = Math.round(n * 10) / 10;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}pt`;
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(r.width * dpr));
  canvas.height = Math.max(1, Math.floor(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function holdingsOf(code) {
  return state.data.edges
    .filter((e) => e.h === code)
    .sort((a, b) => b.r - a.r);
}

function holdersListed(code) {
  return state.data.edges
    .filter((e) => e.i === code)
    .sort((a, b) => b.r - a.r);
}

function company(code) {
  return state.by.get(code);
}

function select(code) {
  if (!state.by.has(code)) return;
  state.focus = code;
  state.mode = "ego";
  document.querySelectorAll(".mode").forEach((b) => {
    b.setAttribute("aria-selected", b.dataset.mode === "ego" ? "true" : "false");
  });
  suggest.hidden = true;
  q.value = `${code} ${company(code).name}`;
  renderDetail();
  draw();
}

function renderLists() {
  const hubs = [...state.data.companies]
    .filter((c) => c.outDeg > 0 && c.name !== c.code)
    .sort((a, b) => b.outDeg - a.outDeg || b.pr - a.pr)
    .slice(0, 12);
  document.querySelector("#hubs").innerHTML = hubs.map((c) => row(c, c.outDeg ? `${c.outDeg}社` : "")).join("");

  const drops = state.data.companies
    .filter((c) => c.listedDelta !== null && c.listedDelta <= -5 && (c.listed || 0) >= 8 && c.holders.length)
    .sort((a, b) => a.listedDelta - b.listedDelta)
    .slice(0, 12);
  document.querySelector("#drops").innerHTML = drops.map((c) => row(c, signed(c.listedDelta))).join("");

  const pairs = state.data.mutual
    .map(([a, b]) => {
      const ab = state.data.edges.find((e) => e.h === a && e.i === b);
      const ba = state.data.edges.find((e) => e.h === b && e.i === a);
      return { a, b, w: (ab?.r || 0) + (ba?.r || 0) };
    })
    .sort((x, y) => y.w - x.w);
  document.querySelector("#pairs").innerHTML = pairs.map(({ a, b }) => {
    const A = company(a);
    const B = company(b);
    return `<li><button type="button" data-code="${a}"><span class="code">${a}</span><span class="name">${A.name}</span><span class="num">${b}</span></button>
      <button type="button" data-code="${b}"><span class="code">${b}</span><span class="name">${B.name}</span><span class="num">${a}</span></button></li>`;
  }).join("");

  document.querySelector(".lists").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-code]");
    if (btn) select(btn.dataset.code);
  });
}

function row(c, extra) {
  return `<li><button type="button" data-code="${c.code}"><span class="code">${c.code}</span><span class="name">${escapeHtml(c.name)}</span><span class="num">${extra}</span></button></li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function renderDetail() {
  const c = company(state.focus);
  const box = document.querySelector("#detail");
  if (!c) {
    box.innerHTML = `<p class="quiet">銘柄を選ぶと、大株主と保有先が出ます。</p>`;
    return;
  }
  const owns = holdingsOf(c.code).slice(0, 12);
  const holderRows = (c.holders || []).map((h) => {
    const click = h.code ? ` class="link" data-code="${h.code}"` : "";
    return `<tr${click}><td>${escapeHtml(h.name)}</td><td>${KIND_LABEL[h.kind] || ""}</td><td class="r">${pct(h.ratio)}</td></tr>`;
  }).join("");
  const ownRows = owns.map((e) => {
    const n = company(e.i);
    const label = n.name && n.name !== n.code ? n.name : "社名未収録";
    return `<tr class="link" data-code="${e.i}"><td>${e.i} ${escapeHtml(label)}</td><td class="r">${pct(e.r)}</td></tr>`;
  }).join("");
  const meters = [
    ["安定", c.stable, "stable"],
    ["機関", c.inst, "inst"],
    ["事業会社", c.listed, "corp"],
  ].map(([label, value, cls]) => {
    const w = Math.max(0, Math.min(100, value || 0));
    return `<div><span>${label}</span><div class="bar ${cls}"><span style="width:${w}%"></span></div><b>${pct(value)}</b></div>`;
  }).join("");
  const delta = c.listedDelta === null ? "" : `<p class="delta ${c.listedDelta < 0 ? "down" : ""}">上場事業会社の比率 ${signed(c.listedDelta)}（${c.prior || "前期"} → ${c.period || "直近"}）</p>`;
  const missing = c.holders.length ? "" : `<p class="quiet">この銘柄自身の大株主表は、今回の抽出では取れていません。他社の大株主欄に出てきた持分だけを示します。</p>`;
  box.innerHTML = `
    <p class="who"><span class="code">${c.code}</span></p>
    <h2>${escapeHtml(c.name)}</h2>
    <p class="meta">${escapeHtml(c.sector || "業種未設定")}${c.period ? ` · 期末 ${c.period}` : ""}</p>
    ${c.holders.length ? `<div class="meters">${meters}</div><p class="quiet">この3つは、この銘柄の大株主上位10名の内訳です。</p>${delta}` : missing}
    <h2>大株主</h2>
    ${holderRows ? `<table><thead><tr><th>名前</th><th>区分</th><th class="r">比率</th></tr></thead><tbody>${holderRows}</tbody></table>` : `<p class="quiet">表なし</p>`}
    <h2>この会社が持っている上場株</h2>
    ${ownRows ? `<table><thead><tr><th>銘柄</th><th class="r">比率</th></tr></thead><tbody>${ownRows}</tbody></table>` : `<p class="quiet">名寄せできた保有先はありません。</p>`}
  `;
}

document.querySelector("#detail").addEventListener("click", (ev) => {
  const tr = ev.target.closest("tr[data-code]");
  if (tr) select(tr.dataset.code);
});

function searchMatches(text) {
  const t = text.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return [];
  const out = [];
  for (const c of state.data.companies) {
    const hay = `${c.code}${c.name}`.toLowerCase().replace(/\s/g, "");
    if (hay.includes(t)) out.push(c);
    if (out.length >= 8) break;
  }
  return out;
}

function paintSuggest() {
  const items = state.matches;
  if (!items.length || document.activeElement !== q) {
    suggest.hidden = true;
    return;
  }
  suggest.hidden = false;
  suggest.innerHTML = items.map((c, i) =>
    `<li><button type="button" data-code="${c.code}" aria-selected="${i === state.suggest}"><span class="code">${c.code}</span><span>${escapeHtml(c.name)}</span></button></li>`
  ).join("");
}

q.addEventListener("input", () => {
  state.matches = searchMatches(q.value);
  state.suggest = 0;
  paintSuggest();
});
q.addEventListener("focus", () => paintSuggest());
q.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") {
    state.suggest = Math.min(state.matches.length - 1, state.suggest + 1);
    paintSuggest();
    ev.preventDefault();
  } else if (ev.key === "ArrowUp") {
    state.suggest = Math.max(0, state.suggest - 1);
    paintSuggest();
    ev.preventDefault();
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const pick = state.matches[state.suggest];
    if (pick) select(pick.code);
  } else if (ev.key === "Escape") {
    suggest.hidden = true;
  }
});
suggest.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-code]");
  if (btn) select(btn.dataset.code);
});
document.querySelector("#search-form").addEventListener("submit", (ev) => ev.preventDefault());
document.addEventListener("keydown", (ev) => {
  if (ev.key === "/" && document.activeElement !== q) {
    ev.preventDefault();
    q.focus();
    q.select();
  }
});

document.querySelectorAll(".mode").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
    draw();
  });
});

function viewSize() {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function toScreen(x, y) {
  const { w, h } = viewSize();
  return [w / 2 + (x + state.cam.x) * state.cam.k, h / 2 + (y + state.cam.y) * state.cam.k];
}

function egoModel() {
  const c = company(state.focus);
  const nodes = [{ id: c.code, name: c.name, kind: "corp", role: "center", ratio: null }];
  const links = [];
  const seen = new Set([c.code]);
  (c.holders || []).forEach((h, i) => {
    const id = h.code || `h${i}`;
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, name: h.name, kind: h.kind, role: "holder", ratio: h.ratio, code: h.code });
    links.push({ from: id, to: c.code, r: h.ratio });
  });
  holdingsOf(c.code).slice(0, 12).forEach((e) => {
    if (!seen.has(e.i)) {
      seen.add(e.i);
      const n = company(e.i);
      nodes.push({ id: e.i, name: n.name, kind: "corp", role: "held", ratio: e.r, code: e.i });
    }
    links.push({ from: c.code, to: e.i, r: e.r });
  });
  const holders = nodes.filter((n) => n.role === "holder");
  const held = nodes.filter((n) => n.role === "held");
  holders.forEach((n, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / Math.max(holders.length, 1)) * Math.PI;
    const rad = 168;
    n.x = Math.cos(a) * rad * (a > Math.PI / 2 ? 1 : -1) - 40;
    n.y = ((i + 0.5) / Math.max(holders.length, 1) - 0.5) * Math.min(420, 36 * holders.length);
    n.x = -190;
    n.y = ((i + 0.5) / Math.max(holders.length, 1) - 0.5) * Math.min(460, 38 * holders.length);
  });
  held.forEach((n, i) => {
    n.x = 210;
    n.y = ((i + 0.5) / Math.max(held.length, 1) - 0.5) * Math.min(460, 38 * held.length);
  });
  nodes[0].x = 0;
  nodes[0].y = 0;
  return { nodes, links, note: "左が大株主、右がこの会社の保有先です。上場会社をクリックすると、その銘柄に移ります。" };
}

function mutualModel() {
  const nodes = [];
  const links = [];
  const pairs = state.data.mutual.slice();
  const half = Math.ceil(pairs.length / 2);
  pairs.forEach(([a, b], i) => {
    const col = i < half ? 0 : 1;
    const row = col === 0 ? i : i - half;
    const y = (row - (half - 1) / 2) * 32;
    const x0 = col === 0 ? -250 : 210;
    const A = company(a);
    const B = company(b);
    const idA = `${a}@${i}`;
    const idB = `${b}@${i}`;
    nodes.push({ id: idA, code: a, name: A.name, kind: "corp", role: "peer", x: x0, y });
    nodes.push({ id: idB, code: b, name: B.name, kind: "corp", role: "peer", x: x0 + 150, y });
    const ab = state.data.edges.find((e) => e.h === a && e.i === b);
    if (ab) links.push({ from: idA, to: idB, r: ab.r });
  });
  return { nodes, links, note: "1行が1組です。左の会社が右の会社を持っている比率を線の上に出しています。相手方向の比率は行をクリックしたあとで見ます。" };
}

function allModel() {
  const ids = new Set(state.data.edges.flatMap((e) => [e.h, e.i]));
  const nodes = [...ids].map((id) => {
    const c = company(id);
    const p = state.data.pos[id] || [0, 0];
    return { id, name: c.name, kind: "corp", role: "peer", code: id, ratio: null, x: p[0] * 460, y: p[1] * 340, pr: c.pr || 0 };
  });
  const links = state.data.edges.map((e) => ({ from: e.h, to: e.i, r: e.r }));
  return { nodes, links, note: "業種ごとに円周へ置き、出資がある組を少し近づけています。点をクリックすると、その銘柄の周辺に移ります。" };
}

function currentModel() {
  if (state.mode === "mutual") return mutualModel();
  if (state.mode === "all") return allModel();
  return egoModel();
}

function draw() {
  if (!state.data) return;
  const { w, h } = viewSize();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#e4ebf0";
  ctx.fillRect(0, 0, w, h);
  const model = currentModel();
  state.model = model;
  document.querySelector("#graph-note").textContent = model.note;
  const showLabel = (n) => {
    if (state.mode !== "all") return true;
    return n.pr >= 0.005 || n.id === state.hover || n.id === state.focus;
  };
  ctx.lineWidth = 1;
  ctx.font = "13px Zen Kaku Gothic New, sans-serif";
  model.links.forEach((l) => {
    const a = model.nodes.find((n) => n.id === l.from);
    const b = model.nodes.find((n) => n.id === l.to);
    if (!a || !b) return;
    const [x1, y1] = toScreen(a.x, a.y);
    const [x2, y2] = toScreen(b.x, b.y);
    ctx.strokeStyle = "rgba(23,38,44,0.28)";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (state.mode !== "all" && l.r >= 3) {
      const center = model.nodes.find((n) => n.role === "center") || model.nodes[0];
      const nearStart = l.from === center.id;
      const t = nearStart ? 0.22 : 0.78;
      ctx.fillStyle = "#4e646e";
      ctx.fillText(`${l.r.toFixed(1)}%`, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    }
  });
  model.nodes.forEach((n) => {
    const [x, y] = toScreen(n.x, n.y);
    const hot = n.id === state.hover || n.id === state.focus;
    const radius = n.role === "center" ? 16 : state.mode === "all" ? (n.pr > 0.006 ? 6 : 3) : 7;
    ctx.beginPath();
    ctx.fillStyle = n.role === "center" ? "#17262c" : (KIND_COLOR[n.kind] || "#0c5552");
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (hot && n.role !== "center") {
      ctx.strokeStyle = "#17262c";
      ctx.stroke();
    }
    if (showLabel(n)) {
      ctx.fillStyle = "#17262c";
      ctx.font = n.role === "center" ? "700 16px Zen Kaku Gothic New, sans-serif" : "500 12px Zen Kaku Gothic New, sans-serif";
      const label = n.role === "center" ? n.name : shorten(n.name);
      if (state.mode === "mutual") {
        ctx.textAlign = "center";
        ctx.fillText(label, x, y - 12);
        ctx.textAlign = "left";
      } else {
        const dx = n.x < -20 ? -ctx.measureText(label).width - 12 : 12;
        ctx.fillText(label, x + (n.role === "center" ? -ctx.measureText(label).width / 2 : dx), y + (n.role === "center" ? 32 : 4));
      }
    }
  });
}

function shorten(name) {
  const s = String(name).replace(/株式会社|（株）|\(株\)/g, "");
  return s.length > 14 ? `${s.slice(0, 14)}…` : s;
}

function hit(px, py) {
  if (!state.model) return null;
  let best = null;
  let bestD = 18;
  state.model.nodes.forEach((n) => {
    const [x, y] = toScreen(n.x, n.y);
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  });
  return best;
}

canvas.addEventListener("mousemove", (ev) => {
  const r = canvas.getBoundingClientRect();
  const n = hit(ev.clientX - r.left, ev.clientY - r.top);
  const id = n ? n.id : null;
  if (id !== state.hover) {
    state.hover = id;
    canvas.style.cursor = n && (n.code || n.role === "center") ? "pointer" : "grab";
    draw();
  }
  if (state.drag) {
    state.cam.x += ev.movementX / state.cam.k;
    state.cam.y += ev.movementY / state.cam.k;
    draw();
  }
});
canvas.addEventListener("mousedown", () => { state.drag = true; });
window.addEventListener("mouseup", () => { state.drag = false; });
canvas.addEventListener("click", (ev) => {
  const r = canvas.getBoundingClientRect();
  const n = hit(ev.clientX - r.left, ev.clientY - r.top);
  const code = n && (n.code || n.id);
  if (code && state.by.has(code)) select(code);
});
canvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const next = state.cam.k * (ev.deltaY > 0 ? 0.92 : 1.08);
  state.cam.k = Math.max(0.45, Math.min(2.6, next));
  draw();
}, { passive: false });

window.addEventListener("resize", resize);

async function boot() {
  const res = await fetch("data/graph.json");
  state.data = await res.json();
  state.data.companies.forEach((c) => state.by.set(c.code, c));
  const withHolders = state.data.companies.filter((c) => c.holders.length).length;
  document.querySelector("#lede").textContent =
    `${state.data.source}。大株主表があるのは ${withHolders.toLocaleString("ja-JP")} 社、上場会社どうしの出資は ${state.data.edges.length.toLocaleString("ja-JP")} 本です。`;
  document.querySelector("#foot").textContent =
    "投資助言ではありません。表の罫線が落ちたテキストから復元しているため、株数と比率の境界を誤ることがあります。検証は有報の原文に戻してください。全体図の配置計算に使った中心性は Colab の A100 で求めています。";
  renderLists();
  if (!state.by.has(state.focus)) state.focus = state.data.companies.find((c) => c.holders.length).code;
  select(state.focus);
  resize();
}

boot();
