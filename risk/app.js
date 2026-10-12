(function () {
  var rows = window.YUHO_READINGS || [];
  var byCode = {};
  rows.forEach(function (row) { byCode[row.code] = row; });

  function norm(text) {
    return String(text || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  }

  function searchMatches(text) {
    var q = norm(text);
    if (!q) return [];
    var exact = [];
    var prefix = [];
    var rest = [];
    rows.forEach(function (row) {
      var code = norm(row.code);
      var name = norm(row.name);
      if (code === q || name === q) exact.push(row);
      else if (code.indexOf(q) === 0 || name.indexOf(q) === 0) prefix.push(row);
      else if (code.indexOf(q) >= 0 || name.indexOf(q) >= 0) rest.push(row);
    });
    return exact.concat(prefix, rest).slice(0, 8);
  }

  function escapeHtml(text) {
    return String(text || "").replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function listOf(label) {
    return rows.filter(function (row) { return row.label === label; });
  }

  function displayName(row) {
    var name = String(row.name || "").trim();
    if (!name || name === row.code) return "社名なし";
    return name;
  }

  var BUCKET_TEXT = {
    added: "見出しが増えた",
    rewrite: "見出しの構成が変わった",
    dropped_only: "見出しが落ちただけ",
    unchanged: "見出しは変わっていない",
    added_wave_only: "同じ年の共通見出しだけ",
    no_headings: "見出しが取れない",
    incomparable: "期が足りず比べられない",
    partial: "期の一部が欠けている"
  };

  var SHORT = {
    calendar: "日付",
    resolved: "解消判断",
    partial: "一部",
    prospect: "未了",
    phrase_gone: "語だけ",
    gc_affirmed: "不確実",
    accounting: "会計",
    incomparable: "比べられない",
    wave_only: "共通見出し",
    added: "見出し増",
    rewrite: "構成変更",
    dropped_only: "見出し減",
    unchanged: "見出し同じ"
  };

  window.YuhoRisk = {
    rows: rows,
    searchMatches: searchMatches,
    listOf: listOf
  };

  var input = document.getElementById("q");
  if (!input) return;

  function effectiveTheme() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set === "dark" || set === "light") return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function syncThemeButton() {
    var btn = document.getElementById("theme");
    if (!btn) return;
    var dark = effectiveTheme() === "dark";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.textContent = dark ? "ライト" : "ダーク";
  }
  syncThemeButton();
  var themeBtn = document.getElementById("theme");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("yuho-theme", next); } catch (e) {}
      syncThemeButton();
    });
  }

  var suggest = document.getElementById("suggest");
  var detail = document.getElementById("detail");
  var calendar = document.getElementById("calendar");
  var resolved = document.getElementById("resolved");
  var foot = document.getElementById("foot");
  var suggestIndex = 0;
  var matches = [];
  var currentCode = "";

  function markCurrent() {
    document.querySelectorAll("button[data-code]").forEach(function (btn) {
      btn.setAttribute("aria-current", btn.getAttribute("data-code") === currentCode ? "true" : "false");
    });
  }

  function paintList(node, label) {
    var items = listOf(label);
    node.innerHTML = items.map(function (row) {
      return '<li><button type="button" data-code="' + row.code + '"><span class="code">' +
        escapeHtml(row.code) + '</span><span>' + escapeHtml(displayName(row)) +
        "</span></button></li>";
    }).join("");
    markCurrent();
  }

  function show(row) {
    if (!row) {
      detail.innerHTML = '<p class="quiet">該当する銘柄がありません。</p>';
      return;
    }
    var addedBody = row.added.length
      ? "<ul>" + row.added.map(function (t) {
          return "<li>" + escapeHtml(t) + "</li>";
        }).join("") + "</ul>"
      : "<p class=\"quiet\">増えた見出しはない。</p>";
    var waveNote = row.hid_wave
      ? "<p class=\"quiet\">同じ年に多くの会社が足した見出しは、ここには並べていません。</p>"
      : "";
    var added = "<h3>増えた見出し</h3>" + addedBody + waveNote;
    var dropped = row.dropped.length
      ? "<h3>落ちた見出し</h3><ul>" + row.dropped.map(function (t) {
          return "<li>" + escapeHtml(t) + "</li>";
        }).join("") + "</ul>"
      : "<h3>落ちた見出し</h3><p class=\"quiet\">落ちた見出しはない。</p>";
    var sentence = row.sentence
      ? '<p class="sentence">' + escapeHtml(row.sentence) + "</p>"
      : "";
    var bucketText = BUCKET_TEXT[row.bucket] || row.bucket || "なし";
    detail.innerHTML =
      '<p class="badge kind-' + escapeHtml(row.kind) + '">' + escapeHtml(row.label_text) + "</p>" +
      "<h2>" + escapeHtml(row.code) + " " + escapeHtml(displayName(row)) + "</h2>" +
      '<p class="meta">見出しの差分は「' + escapeHtml(bucketText) + "」。</p>" +
      '<p class="meta">会計期末 ' + escapeHtml((row.periods || []).join("、") || "なし") +
      "。文書ID " + escapeHtml((row.docs || []).join("、") || "なし") + "。</p>" +
      sentence + added + dropped;
  }

  function paintSuggest() {
    if (!matches.length) {
      suggest.hidden = true;
      suggest.innerHTML = "";
      return;
    }
    suggest.hidden = false;
    suggest.innerHTML = matches.map(function (row, i) {
      return '<li><button type="button" role="option" data-code="' + row.code +
        '" aria-selected="' + (i === suggestIndex) + '"><span class="code">' +
        escapeHtml(row.code) + "</span><span>" + escapeHtml(displayName(row)) +
        '</span><span class="mark">' + escapeHtml(SHORT[row.label] || "") +
        "</span></button></li>";
    }).join("");
  }

  function choose(code) {
    var row = byCode[code];
    if (!row) return;
    input.value = row.code + (displayName(row) === "社名なし" ? "" : " " + displayName(row));
    suggest.hidden = true;
    currentCode = row.code;
    show(row);
    markCurrent();
    if (window.matchMedia("(max-width: 1023px)").matches) detail.scrollIntoView({ block: "start" });
  }

  document.querySelectorAll(".chip").forEach(function (chip) {
    var label = chip.getAttribute("data-list");
    var base = chip.textContent;
    chip.setAttribute("data-base", base);
    chip.textContent = base + " " + listOf(label).length;
  });
  paintList(calendar, "calendar");
  paintList(resolved, "resolved");
  var incomparable = rows.filter(function (row) { return row.label === "incomparable"; }).length;
  foot.textContent =
    "比べた銘柄は " + rows.length + "。比べられないのは " + incomparable +
    " 社で、新しいリスクが無いという意味ではない。番号の無い本文も、1期しか無い銘柄もここに入る。" +
    "出典: EDINET（金融庁）。本データは EDINET 公表情報を編集・加工して作成。有報の全文はこの画面に載せていない。";

  document.body.addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-code]");
    if (button) {
      choose(button.getAttribute("data-code"));
      return;
    }
    var chip = ev.target.closest(".chip");
    if (!chip) return;
    var label = chip.getAttribute("data-list");
    var pressed = chip.getAttribute("aria-pressed") === "true";
    document.querySelectorAll(".chip").forEach(function (el) {
      el.setAttribute("aria-pressed", "false");
    });
    if (pressed) {
      detail.innerHTML = '<p class="quiet">一覧か、上の検索から1社を開く。</p>';
      return;
    }
    chip.setAttribute("aria-pressed", "true");
    var items = listOf(label);
    if (label === "incomparable") {
      detail.innerHTML = "<h2>比べられない</h2>" +
        "<p class=\"sentence\">" + items.length +
        "社。番号も表題も無い本文、会計期末が1期だけ、期の一部が欠けた銘柄です。新しいリスクが無い、という意味ではありません。</p>" +
        "<p class=\"quiet\">コードを検索すると、その銘柄の読みが出ます。</p>";
      return;
    }
    detail.innerHTML = "<h2>" + escapeHtml(chip.getAttribute("data-base") || chip.textContent) + "</h2>" +
      items.map(function (row) {
        return '<p class="badge kind-' + escapeHtml(row.kind) + '">' + escapeHtml(row.label_text) + "</p>" +
          '<p><button type="button" data-code="' + row.code + '">' +
          escapeHtml(row.code) + " " + escapeHtml(displayName(row)) +
          "</button></p><p>" + escapeHtml(row.sentence || "") + "</p>";
      }).join("");
  });

  input.addEventListener("input", function () {
    matches = searchMatches(input.value);
    suggestIndex = 0;
    paintSuggest();
  });
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "ArrowDown") {
      if (!matches.length) return;
      suggestIndex = Math.min(matches.length - 1, suggestIndex + 1);
      paintSuggest();
      ev.preventDefault();
    } else if (ev.key === "ArrowUp") {
      if (!matches.length) return;
      suggestIndex = Math.max(0, suggestIndex - 1);
      paintSuggest();
      ev.preventDefault();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (matches.length) choose(matches[suggestIndex].code);
    } else if (ev.key === "Escape") {
      suggest.hidden = true;
    }
  });
  document.getElementById("search-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
  });
})();
