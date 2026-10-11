const KIND_COLOR = {
  corp: "#8ecae6",
  inst: "#90b4ed",
  foreign: "#90b4ed",
  person: "#e7c27d",
  employee: "#e7c27d",
  insurer: "#e7c27d",
  broker: "#d5dde6",
};
const SECTOR_PALETTE = [
  "#8eb6ff", "#f0a27a", "#7dcea0", "#e7c27d", "#d4a5ff",
  "#7fd1c7", "#f5a3b5", "#a9c4ff", "#f3b6dd", "#c6e38a",
  "#f0c36a", "#8ad7ea", "#f0b7a0", "#b9b6f8", "#9ed9a8",
  "#f2be8a", "#9bb6f0", "#e8a0b4",
];
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
  adj: new Map(),
  mode: "all",
  depth: 1,
  focus: "9435",
  hover: null,
  suggest: 0,
  matches: [],
  cam: { x: 0, y: 0, k: 0.72 },
  drag: null,
  dragNode: null,
  moved: false,
  layoutKey: "",
  model: null,
  sectorColor: new Map(),
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
  state.mode = "local";
  state.layoutKey = "";
  state.cam = { x: 0, y: 0, k: 1 };
  document.querySelectorAll(".mode").forEach((b) => {
    b.setAttribute("aria-selected", b.dataset.mode === "local" ? "true" : "false");
  });
  document.querySelector("#depth").hidden = false;
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
    state.layoutKey = "";
    state.cam = state.mode === "all" ? { x: 0, y: 0, k: 0.72 } : { x: 0, y: 0, k: 1 };
    document.querySelector("#depth").hidden = state.mode !== "local";
    document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
    draw();
  });
});
document.querySelectorAll("#depth button").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.depth = Number(btn.dataset.depth);
    state.layoutKey = "";
    document.querySelectorAll("#depth button").forEach((b) => {
      b.setAttribute("aria-pressed", b === btn ? "true" : "false");
    });
    if (state.mode !== "local") {
      state.mode = "local";
      document.querySelectorAll(".mode").forEach((b) => {
        b.setAttribute("aria-selected", b.dataset.mode === "local" ? "true" : "false");
      });
      document.querySelector("#depth").hidden = false;
    }
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

function sectorOf(code) {
  const c = company(code);
  return (c && c.sector) || "未設定";
}

function colorFor(node) {
  if (node.listed === false) return KIND_COLOR[node.kind] || "#d5dde6";
  const sector = node.sector || "未設定";
  if (!state.sectorColor.has(sector)) {
    const n = state.sectorColor.size;
    state.sectorColor.set(sector, SECTOR_PALETTE[n % SECTOR_PALETTE.length]);
  }
  return state.sectorColor.get(sector);
}

function degree(code) {
  return (state.adj.get(code) || []).length;
}

function listedNeighbors(code, limit) {
  const scored = [];
  const seen = new Set();
  for (const e of state.adj.get(code) || []) {
    if (seen.has(e.other)) continue;
    seen.add(e.other);
    scored.push(e);
  }
  scored.sort((a, b) => b.r - a.r);
  return scored.slice(0, limit).map((e) => e.other);
}

function pushNode(nodes, seen, node) {
  if (seen.has(node.id)) return;
  seen.add(node.id);
  nodes.push(node);
}

function localModel() {
  const c = company(state.focus);
  const nodes = [];
  const seen = new Set();
  pushNode(nodes, seen, {
    id: c.code, code: c.code, name: c.name, sector: c.sector, listed: true,
    kind: "corp", role: "center", deg: degree(c.code),
  });
  (c.holders || []).forEach((h, i) => {
    const id = h.code || `holder:${c.code}:${i}`;
    pushNode(nodes, seen, {
      id, code: h.code || "", name: h.name, sector: h.code ? sectorOf(h.code) : "",
      listed: Boolean(h.code), kind: h.kind, role: "link", deg: h.code ? degree(h.code) : 1,
    });
  });
  listedNeighbors(c.code, 18).forEach((id) => {
    const n = company(id);
    pushNode(nodes, seen, {
      id, code: id, name: n.name, sector: n.sector, listed: true,
      kind: "corp", role: "link", deg: degree(id),
    });
  });
  if (state.depth >= 2) {
    const first = nodes.filter((n) => n.listed && n.id !== c.code).map((n) => n.id);
    first.forEach((id) => {
      listedNeighbors(id, 5).forEach((next) => {
        if (nodes.length >= 72) return;
        const n = company(next);
        pushNode(nodes, seen, {
          id: next, code: next, name: n.name, sector: n.sector, listed: true,
          kind: "corp", role: "link", deg: degree(next),
        });
      });
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const links = [];
  const pair = new Set();
  nodes.forEach((n) => {
    if (!n.listed) {
      links.push({ from: n.id, to: c.code, r: ((c.holders || []).find((h) => (h.code || "") === n.code && h.name === n.name) || {}).ratio || 1 });
      return;
    }
    for (const e of state.adj.get(n.id) || []) {
      if (!ids.has(e.other)) continue;
      const key = [n.id, e.other].sort().join("|");
      if (pair.has(key)) continue;
      pair.add(key);
      const back = (state.adj.get(e.other) || []).some((x) => x.other === n.id);
      links.push({ from: n.id, to: e.other, r: e.r, mutual: back });
    }
  });
  seedCircle(nodes);
  relax(nodes, links, nodes.length > 40 ? 90 : 140);
  const depthLabel = state.depth === 1 ? "隣だけ" : "隣とその先";
  return {
    nodes, links,
    note: `${c.name} の周辺です。${depthLabel}を出しています。点を押すと、その銘柄のノートに移ります。`,
  };
}

function globalModel() {
  const ids = new Set();
  state.data.edges.forEach((e) => { ids.add(e.h); ids.add(e.i); });
  const nodes = [...ids].map((id) => {
    const c = company(id);
    const p = state.data.pos[id] || [Math.random() - 0.5, Math.random() - 0.5];
    return {
      id, code: id, name: c.name, sector: c.sector, listed: true,
      kind: "corp", role: "link", deg: degree(id),
      x: p[0] * 980, y: p[1] * 720,
    };
  });
  const mutual = new Set(state.data.mutual.map(([a, b]) => [a, b].sort().join("|")));
  const links = state.data.edges.map((e) => ({
    from: e.h, to: e.i, r: e.r, mutual: mutual.has([e.h, e.i].sort().join("|")),
  }));
  relax(nodes, links, 48);
  return {
    nodes, links,
    note: "出資のある会社だけを、リンクで引き合う配置にしています。点の大きさはつながりの数、色は業種です。点を押すと、その銘柄の周辺に移ります。",
  };
}

function seedCircle(nodes) {
  const center = nodes.find((n) => n.role === "center") || nodes[0];
  nodes.forEach((n, i) => {
    if (n === center) { n.x = 0; n.y = 0; return; }
    const a = (-Math.PI / 2) + (i / nodes.length) * Math.PI * 2;
    const rad = 150 + (i % 5) * 18;
    n.x = Math.cos(a) * rad;
    n.y = Math.sin(a) * rad;
  });
}

function relax(nodes, links, steps) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cell = nodes.length > 400 ? 92 : 70;
  for (let s = 0; s < steps; s++) {
    const cool = 1 - s / steps;
    const grid = new Map();
    nodes.forEach((n) => {
      const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(n);
      else grid.set(key, [n]);
    });
    nodes.forEach((n) => {
      const cx = Math.floor(n.x / cell);
      const cy = Math.floor(n.y / cell);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iy = cy - 1; iy <= cy + 1; iy++) {
          const bucket = grid.get(`${ix},${iy}`);
          if (!bucket) continue;
          bucket.forEach((m) => {
            if (m.id <= n.id) return;
            let dx = n.x - m.x;
            let dy = n.y - m.y;
            let dist = Math.hypot(dx, dy) || 0.01;
            let force = Math.min(7, (160 * cool) / (dist * dist));
            dx /= dist; dy /= dist;
            n.x += dx * force; n.y += dy * force;
            m.x -= dx * force; m.y -= dy * force;
          });
        }
      }
    });
    links.forEach((l) => {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b) return;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const ideal = nodes.length > 400 ? 58 : 92;
      const mag = (dist - ideal) * 0.045 * cool;
      dx /= dist; dy /= dist;
      a.x += dx * mag; a.y += dy * mag;
      b.x -= dx * mag; b.y -= dy * mag;
    });
    nodes.forEach((n) => {
      n.x += -n.x * 0.015 * cool;
      n.y += -n.y * 0.015 * cool;
    });
  }
}

function fit(nodes) {
  if (!nodes.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  });
  const { w, h } = viewSize();
  if (w < 40 || h < 40) return;
  const pad = 72;
  const bw = Math.max(80, maxX - minX);
  const bh = Math.max(80, maxY - minY);
  const k = Math.max(0.28, Math.min(1.7, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
  state.cam.k = k;
  state.cam.x = -((minX + maxX) / 2);
  state.cam.y = -((minY + maxY) / 2);
}

function currentModel() {
  const key = state.mode === "all" ? "all" : `local:${state.focus}:${state.depth}`;
  if (state.model && state.layoutKey === key) return state.model;
  state.model = state.mode === "all" ? globalModel() : localModel();
  state.model.nodes.forEach(colorFor);
  state.layoutKey = key;
  fit(state.model.nodes);
  renderLegend(state.model.nodes);
  return state.model;
}

function renderLegend(nodes) {
  const counts = new Map();
  nodes.forEach((n) => {
    const label = n.listed ? (n.sector || "未設定") : (KIND_LABEL[n.kind] || "その他");
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  document.querySelector("#legend").innerHTML = top.map(([label]) => {
    const swatch = state.sectorColor.get(label) || KIND_COLOR[Object.keys(KIND_LABEL).find((k) => KIND_LABEL[k] === label)] || "#d5dde6";
    return `<span><i class="swatch" style="background:${swatch}"></i>${escapeHtml(label)}</span>`;
  }).join("");
}

function queryText() {
  return q.value.trim().toLowerCase().replace(/\s/g, "");
}

function nodeMatches(n, text) {
  if (!text) return false;
  return `${n.code || ""}${n.name || ""}`.toLowerCase().replace(/\s/g, "").includes(text);
}

function radiusOf(n) {
  const base = state.mode === "all" ? 1.7 + Math.sqrt(n.deg || 1) * 0.85 : 5 + Math.sqrt(n.deg || 1) * 0.7;
  return n.id === state.focus ? base + 2.4 : base;
}

function draw() {
  if (!state.data) return;
  const { w, h } = viewSize();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#16181d";
  ctx.fillRect(0, 0, w, h);
  const model = currentModel();
  document.querySelector("#graph-note").textContent = model.note;
  const text = queryText();
  const hitId = state.hover;
  const hot = new Set();
  if (hitId) {
    hot.add(hitId);
    model.links.forEach((l) => {
      if (l.from === hitId) hot.add(l.to);
      if (l.to === hitId) hot.add(l.from);
    });
  }
  const byNode = new Map(model.nodes.map((n) => [n.id, n]));
  model.links.forEach((l) => {
    const a = byNode.get(l.from);
    const b = byNode.get(l.to);
    if (!a || !b) return;
    const linked = !hitId || hot.has(a.id) || hot.has(b.id);
    const matched = !text || nodeMatches(a, text) || nodeMatches(b, text);
    const [x1, y1] = toScreen(a.x, a.y);
    const [x2, y2] = toScreen(b.x, b.y);
    const width = l.mutual ? 1.35 : Math.min(2.2, 0.35 + (l.r || 0) / 28);
    ctx.strokeStyle = l.mutual ? "rgba(232,196,122,0.85)" : "rgba(214,222,232,0.28)";
    ctx.globalAlpha = linked && matched ? 1 : 0.08;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  model.nodes.forEach((n) => {
    const [x, y] = toScreen(n.x, n.y);
    const active = !hitId || hot.has(n.id);
    const matched = !text || nodeMatches(n, text);
    const r = radiusOf(n) * (state.mode === "all" ? 1 : 1);
    ctx.globalAlpha = active && matched ? 0.95 : 0.12;
    ctx.beginPath();
    ctx.fillStyle = colorFor(n);
    ctx.arc(x, y, Math.max(1.6, r), 0, Math.PI * 2);
    ctx.fill();
    if (n.id === state.focus || n.id === hitId) {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "#f4f7fb";
      ctx.stroke();
    }
    const hub = state.mode === "all" ? 16 : 1;
    const show = n.id === hitId || n.id === state.focus || (state.cam.k > 1.45 && (n.deg || 0) >= 3) || (n.deg || 0) >= hub;
    if (show && active && matched) {
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = "#eef2f6";
      ctx.font = n.id === state.focus ? "600 13px Zen Kaku Gothic New, sans-serif" : "500 12px Zen Kaku Gothic New, sans-serif";
      ctx.fillText(shorten(n.name), x + r + 4, y + 4);
    }
  });
  ctx.globalAlpha = 1;
}

function shorten(name) {
  const s = String(name || "").replace(/株式会社|（株）|\(株\)/g, "").trim();
  return s.length > 16 ? `${s.slice(0, 16)}…` : s;
}

function hit(px, py) {
  if (!state.model) return null;
  let best = null;
  let bestD = Infinity;
  state.model.nodes.forEach((n) => {
    const [x, y] = toScreen(n.x, n.y);
    const d = Math.hypot(x - px, y - py);
    const reach = radiusOf(n) + 8;
    if (d <= reach && d < bestD) {
      best = n;
      bestD = d;
    }
  });
  return best;
}

canvas.addEventListener("mousemove", (ev) => {
  const r = canvas.getBoundingClientRect();
  const n = hit(ev.clientX - r.left, ev.clientY - r.top);
  if (state.dragNode) {
    if (Math.hypot(ev.movementX, ev.movementY) > 2) state.moved = true;
    state.dragNode.x += ev.movementX / state.cam.k;
    state.dragNode.y += ev.movementY / state.cam.k;
    draw();
    return;
  }
  const id = n ? n.id : null;
  if (id !== state.hover) {
    state.hover = id;
    canvas.style.cursor = n ? "pointer" : (state.drag ? "grabbing" : "grab");
    draw();
  }
  if (state.drag) {
    state.cam.x += ev.movementX / state.cam.k;
    state.cam.y += ev.movementY / state.cam.k;
    draw();
  }
});
canvas.addEventListener("mousedown", (ev) => {
  const r = canvas.getBoundingClientRect();
  const n = hit(ev.clientX - r.left, ev.clientY - r.top);
  state.moved = false;
  if (n) state.dragNode = n;
  else state.drag = true;
});
window.addEventListener("mouseup", () => { state.drag = false; state.dragNode = null; });
canvas.addEventListener("click", (ev) => {
  if (state.moved) return;
  const r = canvas.getBoundingClientRect();
  const n = hit(ev.clientX - r.left, ev.clientY - r.top);
  const code = n && n.code;
  if (code && state.by.has(code)) select(code);
});
canvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const { w, h } = viewSize();
  const mx = ev.clientX - rect.left - w / 2;
  const my = ev.clientY - rect.top - h / 2;
  const prev = state.cam.k;
  const next = Math.max(0.28, Math.min(3.4, prev * (ev.deltaY > 0 ? 0.9 : 1.11)));
  const worldX = mx / prev - state.cam.x;
  const worldY = my / prev - state.cam.y;
  state.cam.k = next;
  state.cam.x = mx / next - worldX;
  state.cam.y = my / next - worldY;
  draw();
}, { passive: false });

window.addEventListener("resize", resize);

async function boot() {
  const res = await fetch("data/graph.json");
  state.data = await res.json();
  state.data.companies.forEach((c) => state.by.set(c.code, c));
  state.data.edges.forEach((e) => {
    if (!state.adj.has(e.h)) state.adj.set(e.h, []);
    if (!state.adj.has(e.i)) state.adj.set(e.i, []);
    state.adj.get(e.h).push({ other: e.i, r: e.r });
    state.adj.get(e.i).push({ other: e.h, r: e.r });
  });
  const withHolders = state.data.companies.filter((c) => c.holders.length).length;
  document.querySelector("#lede").textContent =
    `${state.data.source}。大株主表があるのは ${withHolders.toLocaleString("ja-JP")} 社、上場会社どうしの出資は ${state.data.edges.length.toLocaleString("ja-JP")} 本です。`;
  document.querySelector("#foot").textContent =
    "投資助言ではありません。表の罫線が落ちたテキストから復元しているため、株数と比率の境界を誤ることがあります。検証は有報の原文に戻してください。初期配置の種は、業種の並びと出資関係から置いています。";
  renderLists();
  if (!state.by.has(state.focus)) state.focus = state.data.companies.find((c) => c.holders.length).code;
  renderDetail();
  document.querySelector("#depth").hidden = true;
  resize();
}

boot();
