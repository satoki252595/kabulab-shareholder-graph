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
  mode: "local",
  depth: 1,
  minRatio: 5,
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
  if (state.model && state.model.layout === "stake") fit(state.model.nodes);
  draw();
}

function holdingsOf(code) {
  const best = new Map();
  state.data.edges.forEach((e) => {
    if (e.h !== code) return;
    const prev = best.get(e.i);
    if (!prev || e.r > prev.r) best.set(e.i, e);
  });
  return [...best.values()].sort((a, b) => b.r - a.r);
}

function holdersListed(code) {
  return state.data.edges
    .filter((e) => e.i === code)
    .sort((a, b) => b.r - a.r);
}

function company(code) {
  return state.by.get(code);
}

function stripCo(s) {
  return String(s || "").replace(/株式会社|有限会社|合同会社|（株）|\(株\)/g, "").replace(/\s/g, "");
}

function sameParty(holder, focus) {
  if (!focus) return false;
  if (holder.code && holder.code === focus.code) return true;
  const a = stripCo(holder.name);
  const b = stripCo(focus.name);
  return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
}

function holderLabel(h, all) {
  const peers = (all || []).filter((x) => h.code && x.code === h.code);
  if (peers.length > 1) return h.name;
  if (h.code && state.by.has(h.code)) {
    const n = company(h.code).name;
    if (n && n !== h.code) return n;
  }
  return h.name;
}

function displayName(code) {
  const n = company(code);
  if (n && n.name && n.name !== n.code) return n.name;
  return "社名未収録";
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
  const hubs = state.data.companies
    .map((c) => ({ c, n: holdingsOf(c.code).length }))
    .filter(({ c, n }) => n > 0 && c.name !== c.code)
    .sort((a, b) => b.n - a.n || b.c.pr - a.c.pr)
    .slice(0, 12);
  document.querySelector("#hubs").innerHTML = hubs.map(({ c, n }) => row(c, `${n}社`)).join("");

  const drops = state.data.companies
    .filter((c) => c.listedDelta !== null && c.listedDelta <= -5 && (c.listed || 0) >= 8 && c.holders.length)
    .sort((a, b) => a.listedDelta - b.listedDelta)
    .slice(0, 12);
  document.querySelector("#drops").innerHTML = drops.map((c) => row(c, signed(c.listedDelta), "down")).join("");

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

function row(c, extra, tone) {
  const cls = tone ? ` class="num ${tone}"` : ` class="num"`;
  return `<li><button type="button" data-code="${c.code}"><span class="code">${c.code}</span><span class="name">${escapeHtml(c.name)}</span><span${cls}>${extra}</span></button></li>`;
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
  const owns = holdingsOf(c.code);
  const holderRows = (c.holders || []).map((h) => line(holderLabel(h, c.holders), KIND_LABEL[h.kind] || "", h.ratio, h.code, h.kind)).join("");
  const ownRows = owns.map((e) => line(displayName(e.i), e.i, e.r, e.i, "out")).join("");
  const delta = c.listedDelta === null || Math.abs(c.listedDelta) < 0.5 ? "" : `<p class="delta ${c.listedDelta < 0 ? "down" : ""}">上場の事業会社が持つ比率は前期比 ${signed(c.listedDelta)} です（${c.prior || "前期"}から${c.period || "直近"}）。</p>`;
  const ownTitle = owns.length ? `この会社が持っている上場株　${owns.length}社` : "この会社が持っている上場株";
  box.innerHTML = `
    <p class="who"><span class="code">${c.code}</span></p>
    <h2>${escapeHtml(c.name)}</h2>
    <p class="meta">${escapeHtml(c.sector || "業種未設定")}${c.period ? `　期末 ${c.period}` : ""}</p>
    <p class="reading">${escapeHtml(reading(c))}</p>
    ${mixBar(c)}
    ${delta}
    <h2 class="block">誰がこの株を持っているか</h2>
    ${holderRows || `<p class="quiet">大株主の表は取れていません。他社の有報に出てきた分だけを、下とグラフに出します。</p>`}
    <h2 class="block">${escapeHtml(ownTitle)}</h2>
    ${ownRows || `<p class="quiet">名の一致した保有先はありません。</p>`}
  `;
}

function reading(c) {
  const top = (c.holders || [])[0];
  if (!top) return "この銘柄自身の大株主表は取れていません。他社の大株主欄に出てきた持分だけを示します。";
  const instBit = (c.inst || 0) < 0.5
    ? "機関はほぼいません"
    : c.instDelta === null || Math.abs(c.instDelta) < 0.15
      ? `機関は ${pct(c.inst)}`
      : `機関は ${pct(c.inst)}（前期比 ${signed(c.instDelta)}）`;
  const listedHolder = (c.holders || []).filter((h) => h.code).sort((a, b) => b.ratio - a.ratio)[0];
  let tail;
  if (top.code) tail = "筆頭自体が上場会社です。";
  else if (listedHolder && listedHolder.ratio >= 10) tail = `上場会社では ${holderLabel(listedHolder, c.holders)} が ${pct(listedHolder.ratio)} です。`;
  else tail = "上位10名に、大きな上場の事業会社はほぼいません。";
  const bookN = holdingsOf(c.code).length;
  const book = bookN ? `この会社は上場株を ${bookN} 社持っています。` : "";
  return `筆頭は ${holderLabel(top, c.holders)} で ${pct(top.ratio)}。${instBit}。${tail}${book}`;
}

function mixBar(c) {
  if (!(c.holders || []).length) return "";
  const parts = [
    ["inst", c.inst || 0, "機関"],
    ["people", (c.person || 0) + (c.employee || 0), "個人・持株会"],
    ["insurer", c.insurer || 0, "保険"],
    ["corp", c.corp || 0, "事業会社"],
  ];
  const sum = parts.reduce((s, p) => s + Math.max(0, p[1]), 0);
  const scale = sum > 100 ? 100 / sum : 1;
  const bar = parts.map(([k, v]) => `<span class="${k}" style="width:${Math.max(0, v) * scale}%"></span>`).join("");
  const legend = parts.filter(([, v]) => v >= 0.5).map(([k, v, label]) => {
    let extra = "";
    if (k === "corp" && (c.listed || 0) < 1) extra = "（上場はほぼなし）";
    else if (k === "corp" && c.listed) extra = `（うち上場 ${pct(c.listed)}）`;
    return `<span>${label} <b>${pct(v)}</b>${extra}</span>`;
  }).join("");
  const covered = c.top10 || 0;
  const rest = Math.max(0, 100 - covered);
  const restNote = rest >= 1
    ? `上位10名で ${pct(covered)}。残りの ${pct(rest)} はこの表の外です。`
    : `上位10名で ${pct(covered)}。`;
  return `<div class="mix" aria-hidden="true">${bar}</div><p class="mix-legend">${legend}</p><p class="quiet">${restNote}</p>`;
}

function line(name, kind, ratio, code, tone) {
  const w = Math.max(0, Math.min(100, ratio || 0));
  const toneClass = tone === "inst" || tone === "foreign" ? "inst"
    : tone === "person" || tone === "employee" || tone === "insurer" ? "people"
      : tone === "out" ? "out" : "corp";
  const tag = code ? "button" : "div";
  const type = code ? ` type="button"` : "";
  const cls = code ? "line link" : "line";
  const data = code ? ` data-code="${code}"` : "";
  return `<${tag}${type} class="${cls}"${data}><span class="nm">${escapeHtml(name)}</span><b>${pct(ratio)}</b><span class="sub">${escapeHtml(kind)}</span><span class="track ${toneClass}"><span style="width:${w}%"></span></span></${tag}>`;
}

document.querySelector("#detail").addEventListener("click", (ev) => {
  const rowEl = ev.target.closest("[data-code]");
  if (rowEl) select(rowEl.dataset.code);
});

function searchMatches(text) {
  const t = text.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return [];
  const scored = [];
  for (const c of state.data.companies) {
    const code = c.code.toLowerCase();
    const name = c.name.toLowerCase().replace(/\s/g, "");
    let score = 0;
    if (code === t) score = 100;
    else if (code.startsWith(t)) score = 80;
    else if (name.startsWith(t)) score = 60;
    else if (name.includes(t) || code.includes(t)) score = 40;
    else continue;
    scored.push([score, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].code.localeCompare(b[1].code, "ja"));
  return scored.slice(0, 8).map((pair) => pair[1]);
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
document.querySelectorAll("#depth button[data-depth]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.depth = Number(btn.dataset.depth);
    state.layoutKey = "";
    document.querySelectorAll("#depth button[data-depth]").forEach((b) => {
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
document.querySelector("#floor").addEventListener("click", () => {
  state.minRatio = state.minRatio ? 0 : 5;
  state.layoutKey = "";
  state.mode = "local";
  document.querySelector("#depth").hidden = false;
  document.querySelectorAll(".mode").forEach((b) => {
    b.setAttribute("aria-selected", b.dataset.mode === "local" ? "true" : "false");
  });
  syncFloor();
  draw();
});

function syncFloor() {
  const btn = document.querySelector("#floor");
  const on = state.minRatio > 0;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "5%以上だけ" : "小さい持分も";
}

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

function stakeModel() {
  const c = company(state.focus);
  const nodes = [];
  const links = [];
  nodes.push({
    id: c.code, code: c.code, name: c.name, sector: c.sector, listed: true,
    kind: "corp", role: "center", side: "center", deg: degree(c.code),
    x: 0, y: 0, pinned: true,
  });
  const holders = (c.holders || []).filter((h) => !state.minRatio || h.ratio >= state.minRatio);
  const owns = holdingsOf(c.code).filter((e) => !state.minRatio || e.r >= state.minRatio);
  const gap = state.depth >= 2 ? 68 : 52;
  const shownH = holders.slice(0, 16);
  const shownO = owns.slice(0, state.depth >= 2 ? 12 : 16);
  placeColumn(nodes, shownH, -340, gap, (h, i) => ({
    id: `in:${i}:${h.code || "x"}`,
    code: h.code || "",
    name: holderLabel(h, c.holders),
    sector: h.code ? sectorOf(h.code) : "",
    listed: Boolean(h.code),
    kind: h.kind,
    role: "link",
    side: "in",
    ratio: h.ratio,
    deg: h.code ? degree(h.code) : 1,
  }), (node) => links.push({ from: node.id, to: c.code, r: node.ratio, dir: "in" }));
  placeColumn(nodes, shownO, 340, gap, (e) => {
    const node = {
      id: `out:${e.i}`,
      code: e.i,
      name: displayName(e.i),
      sector: sectorOf(e.i),
      listed: true,
      kind: "corp",
      role: "link",
      side: "out",
      ratio: e.r,
      deg: degree(e.i),
    };
    if (state.depth >= 2) {
      const issuer = company(e.i);
      const top = issuer && (issuer.holders || []).find((h) => !sameParty(h, c));
      if (top) {
        node.controller = holderLabel(top, issuer.holders);
        node.controllerRatio = top.ratio;
      }
    }
    return node;
  }, (node) => links.push({ from: c.code, to: node.id, r: node.ratio, dir: "out" }));
  let note = "点を押すと、その銘柄に移ります。";
  if (state.minRatio) note += "5%未満は隠しています。";
  if (holders.length > shownH.length || owns.length > shownO.length) note += "残りは右の一覧です。";
  if (state.depth >= 2) note += "持ち株の下に、その筆頭を添えています。";
  return { nodes, links, note, layout: "stake" };
}

function placeColumn(nodes, items, x, gap, make, link) {
  const y0 = -((items.length - 1) * gap) / 2;
  items.forEach((item, i) => {
    const node = make(item, i);
    node.x = x;
    node.y = y0 + i * gap;
    nodes.push(node);
    link(node);
  });
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
  return {
    nodes, links,
    note: "出資でつながった会社です。近い点ほど、あいだに持ち合いがあります。",
  };
}

function seedCircle(nodes) {
  const center = nodes.find((n) => n.role === "center") || nodes[0];
  nodes.forEach((n, i) => {
    if (n === center) { n.x = 0; n.y = 0; n.pinned = true; return; }
    const a = (-Math.PI / 2) + (i / nodes.length) * Math.PI * 2;
    const rad = 150 + (i % 5) * 18;
    n.x = Math.cos(a) * rad;
    n.y = Math.sin(a) * rad;
  });
}

function relax(nodes, links, steps, fixedAlpha) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const big = nodes.length > 400;
  const cell = big ? 56 : 86;
  const ideal = big ? 34 : 156;
  for (let s = 0; s < steps; s++) {
    const cool = fixedAlpha === undefined ? 1 - s / Math.max(steps, 1) : fixedAlpha;
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
            const force = Math.min(big ? 4 : 11, ((big ? 90 : 320) * cool) / (dist * dist));
            dx /= dist; dy /= dist;
            if (!n.pinned) { n.x += dx * force; n.y += dy * force; }
            if (!m.pinned) { m.x -= dx * force; m.y -= dy * force; }
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
      const mag = (dist - ideal) * (big ? 0.08 : 0.06) * Math.max(cool, 0.15);
      dx /= dist; dy /= dist;
      if (!a.pinned) { a.x += dx * mag; a.y += dy * mag; }
      if (!b.pinned) { b.x -= dx * mag; b.y -= dy * mag; }
    });
    nodes.forEach((n) => {
      if (n.pinned) { n.x = 0; n.y = 0; return; }
      n.x += -n.x * 0.012 * cool;
      n.y += -n.y * 0.012 * cool;
    });
  }
}

function heat(alpha) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  state.alpha = Math.max(state.alpha || 0, alpha);
  if (state.loop) return;
  state.loop = true;
  const frame = () => {
    const model = state.model;
    if (!model || state.alpha < 0.02) {
      state.loop = false;
      state.alpha = 0;
      if (model) fit(model.nodes);
      draw();
      return;
    }
    relax(model.nodes, model.links, 1, state.alpha);
    state.alpha *= 0.975;
    draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
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
  const padX = state.mode === "all" ? 72 : Math.max(132, Math.min(210, w * 0.22));
  const padY = state.mode === "all" ? 72 : 32;
  const bw = Math.max(80, maxX - minX);
  const bh = Math.max(80, maxY - minY);
  const k = Math.max(0.28, Math.min(1.7, Math.min((w - padX * 2) / bw, (h - padY * 2) / bh)));
  state.cam.k = k;
  state.cam.x = -((minX + maxX) / 2);
  state.cam.y = -((minY + maxY) / 2);
}

function currentModel() {
  const key = state.mode === "all" ? "all" : `local:${state.focus}:${state.depth}:${state.minRatio}`;
  if (state.model && state.layoutKey === key) return state.model;
  state.model = state.mode === "all" ? globalModel() : stakeModel();
  state.model.nodes.forEach((n) => { n.fill = nodeFill(n); });
  state.layoutKey = key;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (state.mode === "all" && reduce) relax(state.model.nodes, state.model.links, 24);
  fit(state.model.nodes);
  renderLegend();
  if (state.mode === "all" && !reduce) heat(1);
  return state.model;
}

function nodeFill(n) {
  if (n.role === "center" || n.id === state.focus) return "#c4b5fd";
  if (n.side === "out") return "#d4d4d8";
  if (!n.listed) {
    if (n.kind === "inst" || n.kind === "foreign") return "#93c5fd";
    if (n.kind === "person" || n.kind === "employee" || n.kind === "insurer") return "#f5d48a";
    return "#e4e4e7";
  }
  return "#d4d4d8";
}

function renderLegend() {
  const legend = document.querySelector("#legend");
  if (state.mode !== "all") {
    legend.hidden = true;
    legend.innerHTML = "";
    return;
  }
  legend.hidden = false;
  legend.innerHTML = [
    ["#c4b5fd", "開いている銘柄"],
    ["#d4d4d8", "上場会社"],
    ["#e7c27d", "持ち合い"],
  ].map(([color, label]) => `<span><i class="swatch" style="background:${color}"></i>${label}</span>`).join("");
}

function queryText() {
  const typed = q.value.trim().toLowerCase().replace(/\s/g, "");
  if (!typed || !state.focus || !state.by.has(state.focus)) return typed;
  const selected = `${state.focus}${company(state.focus).name}`.toLowerCase().replace(/\s/g, "");
  return typed === selected ? "" : typed;
}

function nodeMatches(n, text) {
  if (!text) return false;
  return `${n.code || ""}${n.name || ""}`.toLowerCase().replace(/\s/g, "").includes(text);
}

function radiusOf(n) {
  if (n.role === "center") return 16;
  if (state.mode !== "all" && n.ratio) return Math.min(22, 5 + Math.sqrt(n.ratio) * 1.8);
  const base = state.mode === "all" ? 1.7 + Math.sqrt(n.deg || 1) * 0.85 : 5 + Math.sqrt(n.deg || 1) * 0.7;
  return n.id === state.focus ? base + 2.4 : base;
}

function draw() {
  if (!state.data) return;
  const { w, h } = viewSize();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1e1e1e";
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
    const on = !hitId || hot.has(a.id) || hot.has(b.id);
    const matched = !text || nodeMatches(a, text) || nodeMatches(b, text);
    if (model.layout === "stake") {
      drawStakeLink(a, b, l, on, matched, hitId);
      return;
    }
    const [x1, y1] = toScreen(a.x, a.y);
    const [x2, y2] = toScreen(b.x, b.y);
    ctx.strokeStyle = hitId && on ? "#c4b5fd" : (l.mutual ? "#e7c27d" : "#8a8a8a");
    ctx.globalAlpha = on && matched ? (hitId ? 0.85 : 0.38) : 0.045;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  if (model.layout === "stake") {
    model.nodes.forEach((n) => {
      const [x, y] = toScreen(n.x, n.y);
      const active = !hitId || hot.has(n.id);
      const matched = !text || nodeMatches(n, text);
      const r = Math.max(4, radiusOf(n));
      ctx.globalAlpha = active && matched ? 1 : 0.1;
      ctx.beginPath();
      ctx.fillStyle = n.role === "center" ? "#c4b5fd" : (n.fill || nodeFill(n));
      if (n.role === "center" || n.id === hitId) {
        ctx.shadowColor = n.role === "center" ? "#c4b5fd" : "#ffffff";
        ctx.shadowBlur = 14;
      }
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    drawStakeLabels(model, hot, hitId, text);
    drawStakeCaptions(model);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    return;
  }
  const boxes = [];
  const ordered = model.nodes.slice().sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
  ordered.forEach((n) => {
    const [x, y] = toScreen(n.x, n.y);
    const active = !hitId || hot.has(n.id);
    const matched = !text || nodeMatches(n, text);
    const r = Math.max(state.mode === "all" ? 1.8 : 3.5, radiusOf(n));
    ctx.globalAlpha = active && matched ? 1 : 0.08;
    ctx.beginPath();
    ctx.fillStyle = n.id === state.focus ? "#c4b5fd" : (n.fill || nodeFill(n));
    if (n.id === state.focus || n.id === hitId) {
      ctx.shadowColor = n.id === state.focus ? "#c4b5fd" : "#ffffff";
      ctx.shadowBlur = 14;
    }
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    const forced = n.id === hitId || n.id === state.focus;
    const want = state.mode !== "all" || forced || (state.cam.k > 1.6 && (n.deg || 0) >= 12);
    if (!want || !active || !matched) return;
    const stake = n.ratio ? ` ${pct(n.ratio)}` : "";
    const label = `${shorten(n.name)}${n.role === "center" ? "" : stake}`;
    ctx.font = "500 12px Zen Kaku Gothic New, sans-serif";
    const tw = ctx.measureText(label).width;
    const lx = x + r + 5;
    const ly = y + 4;
    const box = { x: lx, y: ly - 11, w: tw, h: 14 };
    const crowded = boxes.some((b) => !(box.x > b.x + b.w + 2 || b.x > box.x + box.w + 2 || box.y > b.y + b.h || b.y > box.y + box.h));
    if (crowded && !forced) return;
    boxes.push(box);
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = "#ececec";
    ctx.fillText(label, lx, ly);
  });
  ctx.globalAlpha = 1;
}

function shorten(name, limit = 16) {
  const s = stripCo(name).trim();
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function fitLabel(name, ratioText, maxW) {
  const stake = ratioText ? ` ${ratioText}` : "";
  const full = `${shorten(name, 18)}${stake}`;
  if (ctx.measureText(full).width <= maxW) return full;
  const stakeW = ctx.measureText(stake).width;
  let room = maxW - stakeW;
  if (room < 28) return ratioText || full;
  let body = stripCo(name).trim();
  const ell = "…";
  while (body.length > 1 && ctx.measureText(body + ell).width > room) body = body.slice(0, -1);
  return `${body}${ell}${stake}`;
}

function drawStakeLink(a, b, l, on, matched, hitId) {
  const [x1, y1] = toScreen(a.x, a.y);
  const [x2, y2] = toScreen(b.x, b.y);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const r1 = Math.max(3.5, radiusOf(a)) + 2;
  const r2 = Math.max(3.5, radiusOf(b)) + (b.role === "center" ? 20 : 12);
  const sx = x1 + ux * r1;
  const sy = y1 + uy * r1;
  const ex = x2 - ux * r2;
  const ey = y2 - uy * r2;
  ctx.strokeStyle = hitId && on ? "#c4b5fd" : "#b7b7c2";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = on && matched ? (hitId ? 0.95 : 0.72) : 0.08;
  ctx.lineWidth = Math.max(1, Math.min(4.5, (l.r || 1) / 7));
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * 9 - uy * 4.5, ey - uy * 9 + ux * 4.5);
  ctx.lineTo(ex - ux * 9 + uy * 4.5, ey - uy * 9 - ux * 4.5);
  ctx.closePath();
  ctx.fill();
}

function drawStakeLabels(model, hot, hitId, text) {
  model.nodes.forEach((n) => {
    const active = !hitId || hot.has(n.id);
    const matched = !text || nodeMatches(n, text);
    if (!active || !matched) return;
    const [x, y] = toScreen(n.x, n.y);
    const r = Math.max(3.5, radiusOf(n));
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = n.id === hitId || n.role === "center" ? "#ffffff" : "#e8e8e8";
    ctx.textBaseline = "middle";
    if (n.role === "center") {
      ctx.textAlign = "center";
      ctx.font = "700 15px Zen Kaku Gothic New, sans-serif";
      ctx.fillText(shorten(n.name, 18), x, y + r + 18);
      return;
    }
    ctx.font = "500 12px Zen Kaku Gothic New, sans-serif";
    const { w } = viewSize();
    const ratioText = n.ratio ? pct(n.ratio) : "";
    if (n.side === "in") {
      const maxW = Math.max(48, x - r - 14);
      ctx.textAlign = "right";
      ctx.fillText(fitLabel(n.name, ratioText, maxW), x - r - 8, y);
    } else {
      const maxW = Math.max(48, w - (x + r + 14));
      ctx.textAlign = "left";
      ctx.fillText(fitLabel(n.name, ratioText, maxW), x + r + 8, n.controller ? y - 8 : y);
      if (n.controller) {
        ctx.fillStyle = "#d6ccf5";
        ctx.font = "500 11px Zen Kaku Gothic New, sans-serif";
        ctx.fillText(`筆頭 ${fitLabel(n.controller, pct(n.controllerRatio), Math.max(36, maxW - 32))}`, x + r + 8, y + 9);
      }
    }
  });
}

function drawStakeCaptions(model) {
  ctx.font = "500 13px Zen Kaku Gothic New, sans-serif";
  ctx.fillStyle = "#aeb6c2";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 0.95;
  const specs = [];
  if (model.nodes.some((n) => n.side === "in")) specs.push(["in", -340, "この株の持ち主"]);
  if (model.nodes.some((n) => n.side === "out")) specs.push(["out", 340, "この会社の持ち株"]);
  if (!specs.length) return;
  const placed = specs.map(([side, fallbackX]) => {
    const group = model.nodes.filter((n) => n.side === side);
    const x = group.length ? group.reduce((s, n) => s + n.x, 0) / group.length : fallbackX;
    const top = group.length ? Math.min(...group.map((n) => n.y)) : 0;
    const [sx, sy] = toScreen(x, top);
    return { sx, sy };
  });
  const y = Math.max(20, Math.min(...placed.map((p) => p.sy)) - 28);
  specs.forEach(([, , text], i) => ctx.fillText(text, placed[i].sx, y));
}

function showTip(n, ev) {
  const tip = document.querySelector("#tip");
  if (!n || state.drag || state.dragNode) {
    tip.hidden = true;
    return;
  }
  const role = n.side === "in" ? "この株の持ち主"
    : n.side === "out" ? "この会社の持ち株"
      : n.side === "far" ? "その銘柄の筆頭"
        : n.role === "center" ? "見ている銘柄" : "上場会社";
  const stake = n.ratio ? `\n${pct(n.ratio)}` : "";
  const code = n.code ? `  ${n.code}` : "";
  tip.hidden = false;
  tip.textContent = `${n.name}${code}\n${role}${stake}`;
  const stage = canvas.parentElement.getBoundingClientRect();
  tip.style.left = `${Math.min(ev.clientX - stage.left + 14, stage.width - 220)}px`;
  tip.style.top = `${Math.min(ev.clientY - stage.top + 16, stage.height - 78)}px`;
}

function hit(px, py) {
  if (!state.model) return null;
  if (state.model.layout === "stake") {
    let best = null;
    let bestD = Infinity;
    state.model.nodes.forEach((n) => {
      const [x, y] = toScreen(n.x, n.y);
      const r = radiusOf(n);
      const dy = Math.abs(py - y);
      if (dy > Math.max(16, r + 4)) return;
      let x0 = x - r - 6;
      let x1 = x + r + 6;
      if (n.side === "in") x0 = x - 200;
      if (n.side === "out" || n.side === "far") x1 = x + 200;
      if (px < x0 || px > x1) return;
      const d = dy;
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    });
    return best;
  }
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
  const stake = state.model && state.model.layout === "stake";
  if (state.dragNode && !stake) {
    if (Math.hypot(ev.movementX, ev.movementY) > 2) state.moved = true;
    if (state.dragNode.role !== "center") state.dragNode.pinned = false;
    state.dragNode.x += ev.movementX / state.cam.k;
    state.dragNode.y += ev.movementY / state.cam.k;
    if (state.dragNode.role === "center") {
      state.dragNode.x = 0;
      state.dragNode.y = 0;
    }
    document.querySelector("#tip").hidden = true;
    heat(0.42);
    return;
  }
  if ((state.dragNode && stake) || state.drag) {
    if (Math.hypot(ev.movementX, ev.movementY) > 2) state.moved = true;
    state.cam.x += ev.movementX / state.cam.k;
    state.cam.y += ev.movementY / state.cam.k;
    document.querySelector("#tip").hidden = true;
    draw();
    return;
  }
  const id = n ? n.id : null;
  if (id !== state.hover) {
    state.hover = id;
    const clickable = n && n.code && state.by.has(n.code);
    canvas.style.cursor = clickable ? "pointer" : "grab";
    draw();
  }
  showTip(n, ev);
});
canvas.addEventListener("mouseleave", () => {
  state.hover = null;
  document.querySelector("#tip").hidden = true;
  if (state.data) draw();
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
  const named = state.data.companies.filter((c) => c.name && c.name !== c.code).length;
  document.querySelector("#lede").textContent =
    `載っている銘柄は ${named.toLocaleString("ja-JP")} 社です。大株主表が読めたのは ${withHolders.toLocaleString("ja-JP")} 社です。コードか社名で、誰が何%持っているかを見てください。`;
  document.querySelector("#foot").textContent =
    "投資助言ではありません。有報の表をテキストから復元しているため、比率が原文と違う行があります。表を読めなかった銘柄は社名だけ出します。";
  renderLists();
  if (!state.by.has(state.focus)) state.focus = state.data.companies.find((c) => c.holders.length).code;
  select(state.focus);
  resize();
}

boot();
