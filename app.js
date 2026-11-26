// JARVIS v0.4 – giao diện Dashboard (Windows app + web/điện thoại)
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const CFG_KEY = "jarvis.cfg";
  const DEF = window.JARVIS_CONFIG || {};
  let sb = null, cfg = null;
  const state = {
    view: "dash", tasks: [], approvals: [], runs: [], comps: [], vids: [], plat: "youtube",
    filter: "all", assist: null, inbox: "pending", logf: "all",
    d: null, range: 30, mkPlat: "youtube", lenPlat: "tiktok", settings: {},
  };

  // ---------- tiện ích ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function md(s) {
    return esc(s)
      .replace(/^#{1,6}\s*(.+)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  const stripPreamble = (s) => String(s || "").replace(/^\s*(Mình sẽ|Tôi sẽ|Dưới đây|Được rồi|Ok[,.]|Vâng|Sau đây)[^\n]*\n+/i, "");
  const TZ = "Asia/Ho_Chi_Minh";
  const vnDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  const vnHour = (d) => Number(new Date(d).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }));
  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
    const today = vnDay(Date.now());
    if (vnDay(d) === today) return `Hôm nay, ${time}`;
    if (vnDay(d) === vnDay(Date.now() + 864e5)) return `Ngày mai, ${time}`;
    if (vnDay(d) === vnDay(Date.now() - 864e5)) return `Hôm qua, ${time}`;
    return `${d.toLocaleDateString("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit" })}, ${time}`;
  };
  const isToday = (iso) => iso && vnDay(iso) === vnDay(Date.now());
  const nf = (n) => (n == null || isNaN(n) ? "?" : Number(n).toLocaleString("vi-VN"));
  const short = (n) => {
    if (n == null || isNaN(n)) return "?";
    n = Number(n);
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(".", ",") + "K";
    return String(Math.round(n));
  };
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const dec = (n, k = 1) => Number(n).toLocaleString("vi-VN", { maximumFractionDigits: k, minimumFractionDigits: 0 });

  // ---------- kết nối ----------
  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch { return null; } }
  function connect(c) { cfg = c; sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, storageKey: "jarvis.auth" } }); }

  async function start() {
    cfg = loadCfg() || (DEF.url && DEF.key ? { url: DEF.url, key: DEF.key } : null);
    if (cfg) {
      connect(cfg);
      const { data } = await sb.auth.getSession();
      if (data.session) return enterApp(data.session);
      $("#cfg-url").value = cfg.url; $("#cfg-key").value = cfg.key;
    } else {
      $(".srv").open = true;
    }
    $("#login").classList.remove("hidden");
  }

  $("#login-btn").addEventListener("click", async () => {
    $("#login-err").textContent = "";
    const c = { url: $("#cfg-url").value.trim().replace(/\/$/, ""), key: $("#cfg-key").value.trim() };
    if (!c.url || !c.key) { $(".srv").open = true; return ($("#login-err").textContent = "Cần nhập Project URL và key ở mục Máy chủ."); }
    try {
      connect(c);
      const { data, error } = await sb.auth.signInWithPassword({ email: $("#login-email").value.trim(), password: $("#login-pass").value });
      if (error) throw error;
      localStorage.setItem(CFG_KEY, JSON.stringify(c));
      enterApp(data.session);
    } catch (e) { $("#login-err").textContent = "Không đăng nhập được: " + (e.message || e); }
  });

  async function enterApp(session) {
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#set-url").textContent = cfg.url;
    $("#set-user").textContent = session.user.email;
    showView(state.view);
    await refreshAll();
    loadDash();
    sb.channel("jarvis")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "productions" }, () => loadProd().then(() => { if (state.view === "prod") renderProd(); }))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "platform_stats" }, () => loadLive().then(() => { refreshAll(); if (state.view === "mine") renderMine(); if (state.view === "dash") renderMineMini(); }))
      .subscribe();
    loadProd();
    setInterval(refreshAll, 30_000);
    setInterval(() => { if (state.view === "dash") loadDash(); }, 120_000);
    setInterval(tick, 1000); tick();
    handleConnHash();
  }

  function tick() {
    const n = new Date();
    $("#top-clock").textContent = n.toLocaleString("vi-VN", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const el = $("#cd-t");
    if (el && el.dataset.at) {
      let s = Math.max(0, Math.floor((new Date(el.dataset.at) - n) / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s %= 60;
      const p = (x) => String(x).padStart(2, "0");
      el.innerHTML = `<div><b>${p(h)}</b><small>GIỜ</small></div><span class="c">:</span><div><b>${p(m)}</b><small>PHÚT</small></div><span class="c">:</span><div><b>${p(s)}</b><small>GIÂY</small></div>`;
    }
  }

  // ---------- dữ liệu chung ----------
  async function refreshAll() {
    const [t, a, r, st] = await Promise.all([
      sb.from("tasks").select("*").order("id"),
      sb.from("approvals").select("*").order("created_at", { ascending: false }).limit(60),
      sb.from("runs").select("id,task_id,started_at,finished_at,status,output,error,tasks(title,kind)").order("started_at", { ascending: false }).limit(60),
      sb.from("settings").select("key,value").in("key", ["autopilot", "autopilot_saved", "minutes", "goals", "mystats", "hot_hidden", "connections", "oauth_clients", "weekly_plan"]),
    ]);
    state.tasks = t.data ?? []; state.approvals = a.data ?? []; state.runs = r.data ?? [];
    state.settings = Object.fromEntries((st.data ?? []).map((x) => [x.key, x.value]));
    renderBadges(); renderTasks(); renderInbox(); renderLog(); renderAutopilot();
  }

  async function callRunner(payload) {
    const { data } = await sb.auth.getSession();
    const res = await fetch(`${cfg.url}/functions/v1/jarvis-runner`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.key, Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Máy chủ trả lỗi ${res.status}`);
    return res.json();
  }
  function kickScripts() { callRunner({ process_approvals: true }).then(refreshAll).catch(() => {}); setTimeout(refreshAll, 4000); }

  function renderBadges() {
    const pending = state.approvals.filter((x) => x.status === "pending").length;
    $$(".badge-inbox").forEach((b) => { b.textContent = pending; b.classList.toggle("hidden", !pending); });
  }

  // ======================= DASHBOARD =======================
  const DEF_MIN = { research_daily: 90, trend_alert: 20, weekly_ideas: 60, scan_data: 120, script: 150 };
  const KIND_NAME = { research_daily: "Báo cáo research", trend_alert: "Cảnh báo trend", weekly_ideas: "Ý tưởng tuần", scan_data: "Quét số liệu", script: "Viết kịch bản" };
  const minutesMap = () => { try { return { ...DEF_MIN, ...JSON.parse(state.settings.minutes || "{}") }; } catch { return { ...DEF_MIN }; } };
  const SERIES = ["#2BD982", "#3B8BF6", "#A66BFF", "#F2A53A", "#F06BAE"]; // thứ tự cố định
  const ASSIST_ORDER = ["Research", "Phân tích", "Biên kịch", "Trend", "Ý tưởng"];

  async function loadDash() {
    const since = new Date(Date.now() - 62 * 864e5).toISOString();
    const since90 = new Date(Date.now() - 92 * 864e5).toISOString();
    const [r, a, v, c] = await Promise.all([
      sb.from("runs").select("id,task_id,started_at,finished_at,status").gte("started_at", since).order("started_at").limit(3000),
      sb.from("approvals").select("id,kind,status,title,created_at,decided_at,updated_at").gte("created_at", since).limit(2000),
      sb.from("videos").select("platform,video_id,views,likes,comments,duration_s,published_at,followers,title,url,channel_name,channel_id,fetched_at").gte("published_at", since90).order("views", { ascending: false }).limit(3000),
      sb.from("competitors").select("id,platform,status,name,handle,channel_id,followers,url,hits").limit(500),
    ]);
    const tmap = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
    const jobs = [];
    for (const x of r.data ?? []) {
      if (x.status === "running") continue;
      const t = tmap[x.task_id] || {};
      jobs.push({ at: x.finished_at || x.started_at, ok: x.status === "ok", kind: t.kind || "other", asst: t.assistant || "Khác", title: t.title || "Tác vụ", id: x.id, src: "run" });
    }
    let actions = 0;
    for (const x of a.data ?? []) {
      if (x.decided_at && x.title !== "Ý tưởng của anh Thắng") actions++;
      if (x.title === "Ý tưởng của anh Thắng") actions++;
      if (x.kind !== "script" || ["queued", "writing"].includes(x.status)) continue;
      jobs.push({ at: x.updated_at || x.created_at, ok: x.status !== "error", kind: "script", asst: "Biên kịch", title: x.title, id: x.id, src: "script" });
    }
    jobs.sort((p, q) => new Date(p.at) - new Date(q.at));
    state.d = { jobs, actions, vids: v.data ?? [], comps: c.data ?? [] };
    $("#dash-upd").textContent = "Cập nhật " + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
    await loadLive().catch(() => {});
    snapshotFollowers();
    renderDash();
    renderAICard();
    if (state.view === "mine") renderMine();
    if (state.view === "goals") renderGoals();
    if (state.view === "hot") renderHot();
  }

  function dayKeys(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(vnDay(Date.now() - i * 864e5)); return out; }
  function windowStats(jobs, from, to, mins) {
    const w = jobs.filter((j) => { const t = new Date(j.at).getTime(); return t >= from && t < to; });
    const ok = w.filter((j) => j.ok);
    const night = ok.filter((j) => { const h = vnHour(j.at); return h >= 22 || h < 7; });
    const hours = ok.reduce((s, j) => s + (mins[j.kind] ?? 30), 0) / 60;
    return { all: w.length, ok: ok.length, night: night.length, hours, rate: w.length ? (ok.length / w.length) * 100 : 0 };
  }
  function delta(cur, prev, unit = "%") {
    if (unit === "pt") { const d = cur - prev; const c = d > 0.5 ? "up" : d < -0.5 ? "down" : "flat"; return `<span class="delta ${c}">${d >= 0 ? "+" : ""}${dec(d, 0)} điểm</span>`; }
    if (!prev) return cur ? `<span class="delta up">mới</span>` : `<span class="delta flat">—</span>`;
    const p = ((cur - prev) / prev) * 100; const c = p > 0.5 ? "up" : p < -0.5 ? "down" : "flat";
    return `<span class="delta ${c}">${p >= 0 ? "+" : ""}${dec(p, 1)}%</span>`;
  }
  function spark(vals, color, w = 160, h = 40, fill = true) {
    if (!vals.length) return "";
    const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
    const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const id = "g" + Math.random().toString(36).slice(2, 8);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      ${fill ? `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w} ${h} L0 ${h}Z" fill="url(#${id})" stroke="none"/>` : ""}
      <path d="${d}" stroke="${color}" stroke-width="1.8" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderDash() {
    const D = state.d; if (!D) return;
    const mins = minutesMap();
    const now = Date.now(), W = 7 * 864e5;
    const cur = windowStats(D.jobs, now - W, now + 1, mins), prev = windowStats(D.jobs, now - 2 * W, now - W, mins);
    const days30 = dayKeys(30);
    const byDay = Object.fromEntries(days30.map((k) => [k, { ok: 0, all: 0, night: 0, hours: 0 }]));
    for (const j of D.jobs) {
      const k = vnDay(j.at); const b = byDay[k]; if (!b) continue;
      b.all++; if (j.ok) { b.ok++; b.hours += (mins[j.kind] ?? 30) / 60; const h = vnHour(j.at); if (h >= 22 || h < 7) b.night++; }
    }
    const series = (f) => days30.map((k) => f(byDay[k]));
    const pending = state.approvals.filter((x) => x.status === "pending").length;
    const lever = D.actions ? cur.ok / D.actions : 0;

    const kpi = (ico, cls, label, value, unit, dl, sp) => `
      <div class="panel kpi"><div class="top"><span class="ico ${cls}">${ico}</span>${label}</div>
        <div class="v num">${value}${unit ? `<small>${unit}</small>` : ""}</div>
        <div class="foot">${sp}${dl}</div></div>`;
    const I = {
      clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      check: '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>',
      target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
      moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    };

    const html = `
      <div class="grid kpis">
        ${kpi(I.clock, "", "Thời gian trả lại", dec(cur.hours, 1), "giờ", delta(cur.hours, prev.hours), spark(series((b) => b.hours), "#2BD982"))}
        ${kpi(I.check, "b", "Jarvis đã xong", nf(cur.ok), "việc", delta(cur.ok, prev.ok), spark(series((b) => b.ok), "#3B8BF6"))}
        ${kpi(I.target, "p", "Tỷ lệ thành công", dec(cur.rate, 0), "%", delta(cur.rate, prev.rate, "pt"), spark(series((b) => (b.all ? (b.ok / b.all) * 100 : 100)), "#A66BFF"))}
        ${kpi(I.moon, "a", "Làm lúc anh ngủ", nf(cur.night), "việc", `<span class="delta flat">22h–7h</span>`, spark(series((b) => b.night), "#F2A53A"))}
      </div>
      <p class="muted" style="margin:10px 2px 0;font-size:12.5px">7 ngày qua so với 7 ngày trước · Đòn bẩy: mỗi việc anh làm (duyệt, giao ý tưởng), Jarvis làm thêm <b style="color:var(--g)">${lever ? dec(lever, 1) : "—"}</b> việc · ${pending ? `<a href="#" data-go="inbox">${pending} mục đang chờ anh duyệt</a>` : "không có gì chờ duyệt"}</p>

      <h2 class="sec">Kênh của tôi</h2>
      <div class="grid mine-mini" id="mine-mini"></div>

      <div class="grid g-main">
        <div class="stack">
          <div class="panel">
            <div class="ph"><h3>Mục tiêu tuần</h3><a href="#" data-go="goals" style="font-size:12.5px">Mở checklist ›</a></div>
            <div id="goal-mini"></div>
          </div>
          <div class="panel">
            <div class="ph"><h3>Video hot nên làm</h3><a href="#" data-go="hot" style="font-size:12.5px">Xem tất cả ›</a></div>
            <div id="hot-mini"></div>
          </div>
          <div class="panel" id="perf">
            <div class="ph"><h3>Hiệu suất Jarvis · giờ trả lại cộng dồn</h3>
              <div class="range">${[[7, "1T"], [30, "1TH"], [60, "2TH"]].map(([d, l]) => `<button data-range="${d}" class="${state.range === d ? "on" : ""}">${l}</button>`).join("")}</div></div>
            <div id="area-box" style="position:relative"></div>
          </div>
          <div class="panel">
            <div class="ph"><h3>Top kênh ngách</h3><div class="range">${["youtube", "tiktok"].map((p) => `<button data-mk="${p}" class="${state.mkPlat === p ? "on" : ""}">${p === "youtube" ? "YouTube" : "TikTok"}</button>`).join("")}</div></div>
            <div id="mk-list"></div>
          </div>
          <div class="panel">
            <div class="ph"><h3>Độ dài video vs lượt xem (trung vị)</h3><div class="range">${["tiktok", "youtube"].map((p) => `<button data-len="${p}" class="${state.lenPlat === p ? "on" : ""}">${p === "youtube" ? "YouTube" : "TikTok"}</button>`).join("")}</div></div>
            <div id="len-box"></div>
          </div>
        </div>
        <div class="stack">
          <div class="panel"><h3>Phân bổ việc · 30 ngày</h3><div id="donut-box"></div></div>
          <div class="panel"><h3>Sức khỏe Jarvis · 30 ngày</h3><div id="gauge-box"></div></div>
          <div class="panel"><h3>Việc tiếp theo</h3><div id="sig-box"></div></div>
          <div class="panel">
            <div class="ph"><h3>Hiệu suất tuần</h3><div class="lg"><span><i style="background:var(--g)"></i>Tuần này</span><span><i style="background:#3A4A61"></i>Tuần trước</span></div></div>
            <div id="week-box"></div>
          </div>
          <div class="panel"><h3>Hoạt động gần đây</h3><div id="act-box"></div></div>
        </div>
      </div>

      <div class="panel features">
        <div><svg viewBox="0 0 24 24"><path d="M3 20h18M6 16v-3M10 16V9M14 16v-5M18 16V6"/></svg>Số liệu thật<br>YouTube · TikTok · Facebook</div>
        <div><svg viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/></svg>AI phân tích<br>Claude Haiku</div>
        <div><svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>Duyệt trước<br>khi làm tiếp</div>
        <div><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4"/></svg>Chạy 24/7<br>trên cloud</div>
        <div><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4M12 15v2"/></svg>Bảo mật<br>đăng nhập riêng</div>
      </div>`;
    $("#dash").innerHTML = html;
    renderArea(); renderDonut(); renderGauge(); renderSignal(); renderWeek(); renderActivity(); renderMarkets(); renderLen(); renderMineMini(); renderGoalMini(); renderHotMini();
  }

  // ---- biểu đồ vùng: giờ trả lại cộng dồn ----
  function renderArea() {
    const box = $("#area-box"); if (!box || !state.d) return;
    const mins = minutesMap();
    const days = dayKeys(state.range);
    const per = Object.fromEntries(days.map((k) => [k, { h: 0, n: 0 }]));
    for (const j of state.d.jobs) { const b = per[vnDay(j.at)]; if (b && j.ok) { b.h += (mins[j.kind] ?? 30) / 60; b.n++; } }
    let acc = 0; const pts = days.map((k) => { acc += per[k].h; return { k, v: acc, d: per[k] }; });
    const W = Math.max(280, box.clientWidth || 600), H = box.closest(".panel").offsetWidth < 500 ? 200 : 250;
    const L = 40, R = 10, T = 12, B = 26;
    const max = Math.max(1, ...pts.map((p) => p.v)) * 1.1;
    const x = (i) => L + (i / Math.max(1, pts.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const line = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
    const lbl = (k) => { const [, m, d] = k.split("-"); return `${+d}/${+m}`; };
    const step = Math.ceil(pts.length / 5);
    const last = pts[pts.length - 1];
    box.innerHTML = `<svg class="area" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Giờ Jarvis trả lại cộng dồn: ${dec(last.v, 1)} giờ trong ${state.range} ngày">
      <defs><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2BD982" stop-opacity=".32"/><stop offset="1" stop-color="#2BD982" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((t) => `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${dec(t, 0)}h</text>`).join("")}
      ${pts.map((p, i) => (i % step === 0 || i === pts.length - 1) && !(i !== pts.length - 1 && pts.length - 1 - i < step / 2) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${lbl(p.k)}</text>` : "").join("")}
      <path d="${line} L${x(pts.length - 1)} ${H - B} L${L} ${H - B}Z" fill="url(#ag)"/>
      <path d="${line}" stroke="#2BD982" stroke-width="2" fill="none"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="4.5" fill="#2BD982" stroke="#0E1826" stroke-width="2"/>
      <g id="xh" style="display:none"><line id="xh-l" y1="${T}" y2="${H - B}" stroke="#2BD982" stroke-dasharray="3 3" opacity=".7"/><circle id="xh-c" r="5" fill="#2BD982" stroke="#0E1826" stroke-width="2"/></g>
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
    </svg><div class="tipbox" id="area-tip" style="display:none"></div>`;
    const svg = box.querySelector("svg"), tip = $("#area-tip");
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1))));
      const p = pts[i];
      $("#xh").style.display = ""; $("#xh-l").setAttribute("x1", x(i)); $("#xh-l").setAttribute("x2", x(i));
      $("#xh-c").setAttribute("cx", x(i)); $("#xh-c").setAttribute("cy", y(p.v));
      tip.style.display = ""; tip.style.left = (x(i) / W) * r.width + "px"; tip.style.top = (y(p.v) / H) * r.height + "px";
      tip.innerHTML = `<span class="muted">${lbl(p.k)}</span><b>${dec(p.v, 1)} giờ</b><span class="muted">+${dec(p.d.h, 1)}h · ${p.d.n} việc trong ngày</span>`;
    };
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", () => { $("#xh").style.display = "none"; tip.style.display = "none"; });
  }

  // ---- donut: phân bổ việc theo trợ lý ----
  function assistColor(name, names) {
    const known = ASSIST_ORDER.indexOf(name);
    if (known >= 0 && known < SERIES.length) return SERIES[known];
    const extra = names.filter((n) => !ASSIST_ORDER.includes(n)).sort();
    const i = ASSIST_ORDER.filter((n) => names.includes(n)).length + extra.indexOf(name);
    return SERIES[i] || "#5F6F86";
  }
  function renderDonut() {
    const since = Date.now() - 30 * 864e5;
    const cnt = {};
    for (const j of state.d.jobs) if (j.ok && new Date(j.at) >= since) cnt[j.asst] = (cnt[j.asst] || 0) + 1;
    let ent = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const total = ent.reduce((s, e) => s + e[1], 0);
    if (!total) return ($("#donut-box").innerHTML = `<div class="empty">Chưa có việc hoàn thành trong 30 ngày.</div>`);
    if (ent.length > 5) { const rest = ent.slice(4).reduce((s, e) => s + e[1], 0); ent = [...ent.slice(0, 4), ["Khác", rest]]; }
    const names = ent.map((e) => e[0]);
    const R = 60, C = 2 * Math.PI * R; let off = 0;
    const gap = ent.length > 1 ? 3 : 0;
    const arcs = ent.map(([n, v]) => {
      const len = (v / total) * C; const col = n === "Khác" ? "#5F6F86" : assistColor(n, names);
      const s = `<circle r="${R}" cx="75" cy="75" fill="none" stroke="${col}" stroke-width="16" stroke-dasharray="${Math.max(0.1, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)" data-tip="${esc(n)}: ${v} việc (${Math.round((v / total) * 100)}%)"/>`;
      off += len; return s;
    }).join("");
    $("#donut-box").innerHTML = `<div class="donut-wrap">
      <svg class="donut" viewBox="0 0 150 150" role="img" aria-label="Phân bổ ${total} việc theo trợ lý">${arcs}
        <text x="75" y="70" text-anchor="middle" font-size="11" fill="#7F8FA6">Tổng</text>
        <text x="75" y="90" text-anchor="middle" font-size="22" font-weight="700">${nf(total)}</text></svg>
      <div class="legend">${ent.map(([n, v]) => `<div><i style="background:${n === "Khác" ? "#5F6F86" : assistColor(n, names)}"></i><span>${esc(n)}</span><b>${Math.round((v / total) * 100)}%</b></div>`).join("")}</div></div>`;
  }

  // ---- gauge: tỷ lệ thành công ----
  function renderGauge() {
    const since = Date.now() - 30 * 864e5;
    const w = state.d.jobs.filter((j) => new Date(j.at) >= since);
    const ok = w.filter((j) => j.ok).length;
    const v = w.length ? Math.round((ok / w.length) * 100) : 0;
    const err = w.length - ok;
    const word = !w.length ? "Chưa có dữ liệu" : v >= 90 ? "Ổn định" : v >= 70 ? "Cần để ý" : "Nhiều lỗi";
    const col = v >= 90 ? "#2BD982" : v >= 70 ? "#F2A53A" : "#FF5D6C";
    const R = 80, cx = 110, cy = 100;
    const pt = (f) => [cx + R * Math.cos(Math.PI * (1 - f)), cy - R * Math.sin(Math.PI * (1 - f))];
    const arc = (a, b) => { const p = pt(a), q = pt(b); return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} A${R} ${R} 0 0 1 ${q[0].toFixed(1)} ${q[1].toFixed(1)}`; };
    const k = pt(v / 100);
    $("#gauge-box").innerHTML = `<svg class="gauge" viewBox="0 0 220 128" role="img" aria-label="Tỷ lệ thành công ${v}%">
      <path d="${arc(0, 1)}" stroke="#1B293C" stroke-width="12" fill="none" stroke-linecap="round"/>
      ${v ? `<path d="${arc(0, Math.max(0.01, v / 100))}" stroke="${col}" stroke-width="12" fill="none" stroke-linecap="round"/>` : ""}
      <circle cx="${k[0]}" cy="${k[1]}" r="7" fill="${col}" stroke="#0E1826" stroke-width="3"/>
      <text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="30" font-weight="700" fill="#E7EEF6">${v}%</text>
      <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="13" fill="${col}">${word}</text>
      <text x="${cx - R}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#7F8FA6">0</text>
      <text x="${cx + R}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#7F8FA6">100</text></svg>
      <p class="muted" style="margin:4px 0 0;text-align:center;font-size:12.5px">${ok} việc xong · ${err} lỗi${err ? ` · <a href="#" data-go="tasks" data-flt="error">xem lỗi</a>` : ""}</p>`;
  }

  // ---- việc tiếp theo + đếm ngược ----
  function renderSignal() {
    const next = state.tasks.filter((t) => t.enabled && t.next_run_at).sort((a, b) => new Date(a.next_run_at) - new Date(b.next_run_at))[0];
    const off = state.settings.autopilot === "off";
    $("#sig-box").innerHTML = `<div class="signal">
      <svg class="radar" viewBox="0 0 150 150" aria-hidden="true">
        <circle cx="75" cy="75" r="68" fill="none" stroke="#1B293C"/><circle cx="75" cy="75" r="50" fill="none" stroke="rgba(43,217,130,.25)" stroke-dasharray="2 5"/>
        <circle cx="75" cy="75" r="34" fill="rgba(43,217,130,.08)" stroke="#2BD982" stroke-width="2"/>
        <path d="M75 7 A68 68 0 0 1 143 75" stroke="#2BD982" stroke-width="3" fill="none" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 75 75" to="360 75 75" dur="6s" repeatCount="indefinite"/></path>
        <path d="M62 64h26l-13 24z" fill="none" stroke="#2BD982" stroke-width="2.5" stroke-linejoin="round"/><path d="M68 64l7 12 7-12" stroke="#2BD982" stroke-width="2" fill="none"/>
      </svg>
      ${off ? `<p class="muted" style="margin:0;text-align:center">AI tự vận hành đang tắt – Jarvis không tự chạy lịch.</p>`
        : next ? `<div class="cd"><span class="lab"><b style="color:var(--text)">${esc(next.title.split(":")[0].slice(0, 46))}</b><br>${fmt(next.next_run_at)}</span><span class="t" id="cd-t" data-at="${next.next_run_at}"></span></div>`
        : `<p class="muted" style="margin:0">Chưa có lịch chạy.</p>`}
      <button class="btn ghost" data-go="tasks">Xem tất cả nhiệm vụ</button></div>`;
    tick();
  }

  // ---- cột tuần này vs tuần trước ----
  function renderWeek() {
    const names = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    const todayIdx = (new Date(new Date().toLocaleString("en-US", { timeZone: TZ })).getDay() + 6) % 7;
    const startCur = Date.now() - todayIdx * 864e5;
    const cur = Array(7).fill(0), prev = Array(7).fill(0);
    const ck = (t) => vnDay(t);
    const curDays = names.map((_, i) => ck(startCur + i * 864e5)), prevDays = names.map((_, i) => ck(startCur + (i - 7) * 864e5));
    for (const j of state.d.jobs) {
      if (!j.ok) continue; const k = vnDay(j.at);
      let i = curDays.indexOf(k); if (i >= 0) cur[i]++;
      i = prevDays.indexOf(k); if (i >= 0) prev[i]++;
    }
    const max = Math.max(1, ...cur, ...prev);
    $("#week-box").innerHTML = `<div class="bars" role="img" aria-label="Việc xong mỗi ngày, tuần này so với tuần trước">${names.map((n, i) => `
      <div class="day"><span class="b" style="height:${(cur[i] / max) * 100}%" data-tip="${n} tuần này: ${cur[i]} việc"></span><span class="b prev" style="height:${(prev[i] / max) * 100}%" data-tip="${n} tuần trước: ${prev[i]} việc"></span></div>`).join("")}</div>
      <div class="bars-x">${names.map((n) => `<span>${n}</span>`).join("")}</div>
      <p class="muted" style="margin:8px 0 0;font-size:12.5px">Tuần này <b style="color:var(--text)">${cur.reduce((a, b) => a + b, 0)}</b> việc · tuần trước ${prev.reduce((a, b) => a + b, 0)}</p>`;
  }

  // ---- hoạt động gần đây ----
  function renderActivity() {
    const last = [...state.d.jobs].reverse().slice(0, 6);
    if (!last.length) return ($("#act-box").innerHTML = `<div class="empty">Chưa có hoạt động.</div>`);
    $("#act-box").innerHTML = last.map((j) => `
      <div class="act"><span class="d" style="background:${j.ok ? "var(--g-dim)" : "var(--err-dim)"};color:${j.ok ? "var(--g)" : "var(--err)"}">${j.ok ? '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'}</span>
        <span class="tt"><b>${esc(KIND_NAME[j.kind] || j.title.split(":")[0])}</b><small>${esc(j.asst)} · ${fmt(j.at)}</small></span>
        <span class="st ${j.ok ? "status-ok" : "status-error"}">${j.ok ? "Xong" : "Lỗi"}</span></div>`).join("");
  }

  // ---- top kênh ngách (số liệu thật) ----
  function renderMarkets() {
    const p = state.mkPlat, days = p === "youtube" ? 30 : 90;
    const since = Date.now() - days * 864e5;
    const ign = exclSet();
    const by = {};
    for (const v of state.d.vids) {
      if (v.platform !== p || ign.has(p + ":" + v.channel_id) || new Date(v.published_at) < since) continue;
      (by[v.channel_id] ||= { name: v.channel_name, followers: v.followers, list: [] }).list.push(v);
    }
    const compMap = Object.fromEntries(state.d.comps.filter((c) => c.platform === p).map((c) => [c.channel_id, c]));
    const rows = Object.entries(by).map(([id, x]) => {
      const views = x.list.map((v) => v.views || 0);
      const ord = [...x.list].sort((a, b) => new Date(a.published_at) - new Date(b.published_at)).map((v) => v.views || 0);
      const half = Math.floor(ord.length / 2);
      const trendUp = ord.length < 2 || median(ord.slice(half)) >= median(ord.slice(0, half));
      const c = compMap[id];
      return { id, name: c?.name || x.name || id, url: c?.url, pinned: c?.status === "pinned", followers: c?.followers ?? x.followers, med: median(views), n: views.length, ord, trendUp };
    }).sort((a, b) => b.med * Math.min(1, b.n / 2) - a.med * Math.min(1, a.n / 2)).slice(0, 6);
    const avCols = ["#2BD982", "#3B8BF6", "#A66BFF", "#F2A53A", "#F06BAE", "#5FC9E0"];
    $("#mk-list").innerHTML = rows.length ? rows.map((r, i) => `
      <div class="mk"><div class="n"><span class="av" style="background:${avCols[i]}">${esc((r.name || "?").replace(/^@/, "").slice(0, 1).toUpperCase())}</span>
        <span style="min-width:0"><b>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(r.name)}</a>` : esc(r.name)}</b><small>${r.pinned ? "Đã ghim · " : ""}${r.n} video ${days} ngày</small></span></div>
        <span class="r hide-s"><span class="muted" style="font-size:12px">follow</span><br>${short(r.followers)}</span>
        <span class="r"><span class="muted" style="font-size:12px">view TB</span><br><b class="${r.trendUp ? "up" : "down"}">${short(r.med)}</b></span>
        ${r.n > 1 ? `<svg class="sp" viewBox="0 0 110 30" preserveAspectRatio="none">${spark(r.ord, r.trendUp ? "#2BD982" : "#FF5D6C", 110, 30, false).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>` : `<span class="muted" style="font-size:12px;text-align:right">1 video</span>`}
      </div>`).join("") + `<p class="muted" style="margin:10px 0 0;font-size:12px">View TB = trung vị lượt xem mỗi video. Đường xanh: video gần đây xem nhiều hơn video cũ.</p>`
      : `<div class="empty">Chưa có số liệu ${p === "youtube" ? "YouTube" : "TikTok"}. Lần quét tự động lúc 6:00.</div>`;
  }

  // ---- độ dài vs lượt xem ----
  const BUCKETS = {
    youtube: [[0, 61, "Shorts <1 phút"], [61, 480, "1–8 phút"], [480, 900, "8–15 phút"], [900, 1500, "15–25 phút"], [1500, 1e9, "Trên 25 phút"]],
    tiktok: [[0, 30, "Dưới 30s"], [30, 61, "30–60s"], [61, 180, "1–3 phút"], [180, 1e9, "Trên 3 phút"]],
  };
  function lenStats(p) {
    const days = p === "youtube" ? 30 : 90, since = Date.now() - days * 864e5;
    const ign = exclSet();
    const vids = (state.d?.vids || []).filter((v) => v.platform === p && v.duration_s && new Date(v.published_at) >= since && !ign.has(p + ":" + v.channel_id));
    const rows = BUCKETS[p].map(([a, b, l]) => { const vs = vids.filter((v) => v.duration_s >= a && v.duration_s < b).map((v) => v.views || 0); return { l, n: vs.length, med: median(vs) }; });
    const valid = rows.filter((r) => r.n >= 3);
    const best = valid.sort((a, b) => b.med - a.med)[0];
    const out = vids.filter((v) => v.followers && v.views >= 3 * v.followers).length;
    return { rows: BUCKETS[p].map(([, , l]) => rows.find((r) => r.l === l)), best, total: vids.length, days, out };
  }
  function renderLen() {
    const p = state.lenPlat, s = lenStats(p);
    const max = Math.max(1, ...s.rows.map((r) => r.med));
    $("#len-box").innerHTML = s.total ? `<div class="hb">${s.rows.map((r) => `
      <div class="r ${s.best && r.l === s.best.l ? "best" : ""}"><span>${r.l}</span><span class="track"><i style="width:${(r.med / max) * 100}%" data-tip="${r.l}: trung vị ${nf(Math.round(r.med))} view · ${r.n} video"></i></span><b>${short(r.med)} <small>· ${r.n}</small></b></div>`).join("")}</div>
      <p class="muted" style="margin:12px 0 0;font-size:12.5px">${s.best ? `Độ dài ăn view nhất: <b style="color:var(--g)">${s.best.l}</b> · ` : ""}${s.total} video ngách ${s.days} ngày · ${s.out} video "vượt mặt" (view ≥ 3× follow). Nhóm dưới 3 video chưa đủ để kết luận.</p>`
      : `<div class="empty">Chưa có số liệu.</div>`;
  }

  // ---- thẻ gợi ý ở sidebar ----
  function renderAICard() {
    const s = lenStats("tiktok"), y = lenStats("youtube");
    const pick = s.best ? { p: "TikTok", s } : y.best ? { p: "YouTube", s: y } : null;
    if (!pick) return ($("#ai-card").innerHTML = `<span class="k">Gợi ý từ số liệu</span><span class="s">Chờ lần quét số liệu đầu tiên.</span>`);
    const conf = Math.min(95, Math.round(40 + pick.s.best.n * 3));
    $("#ai-card").innerHTML = `<span class="k">◆ Gợi ý từ số liệu</span>
      <span class="h">${pick.p}: làm video ${pick.s.best.l.toLowerCase()}</span>
      <span class="s">Trung vị ${short(pick.s.best.med)} view/video, cao nhất trong ngách (${pick.s.best.n} video, ${pick.s.days} ngày).</span>
      <span class="s" style="margin-top:4px">Độ tin cậy <b style="color:var(--text)">${conf}%</b></span>
      <span class="meter"><i style="width:${conf}%"></i></span>
      <button class="btn ghost sm" data-view="comp" style="margin-top:6px">Xem chi tiết</button>`;
  }

  // ======================= DÙNG CHUNG =======================
  function exclSet() {
    return new Set((state.d?.comps || state.comps || []).filter((c) => c.status === "ignored" || c.status === "mine").map((c) => c.platform + ":" + c.channel_id));
  }
  const getJSON = (k, d) => { try { return state.settings[k] ? JSON.parse(state.settings[k]) : d; } catch { return d; } };
  async function saveJSON(k, obj) {
    state.settings[k] = JSON.stringify(obj);
    const { error } = await sb.from("settings").upsert([{ key: k, value: state.settings[k] }]);
    if (error) alertBox("Không lưu được", error.message);
  }
  const PL = {
    youtube: { n: "YouTube", ico: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.3v5.4l4.6-2.7z" fill="currentColor"/></svg>', c: "#FF6B6B" },
    tiktok: { n: "TikTok", ico: '<svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.6 2.3 4.3 5 4.6"/></svg>', c: "#5FE3F0" },
    facebook: { n: "Facebook", ico: '<svg viewBox="0 0 24 24"><path d="M14 21v-8h3l.5-3.5H14V7.8c0-1 .4-1.8 1.9-1.8H18V3.2c-.4-.1-1.6-.2-2.9-.2-2.8 0-4.6 1.7-4.6 4.8v1.7H7.5V13h3v8"/></svg>', c: "#5B8DEF" },
  };
  const ago = (iso) => Math.max(1, (Date.now() - new Date(iso)) / 864e5);
  const durTxt = (s) => (s == null ? "?" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}p${String(s % 60).padStart(2, "0")}`);

  // ======================= KÊNH CỦA TÔI =======================
  function mineOf(p) { return (state.d?.comps || []).filter((c) => c.platform === p && c.status === "mine"); }
  function mineStats(p) {
    const rows = mineOf(p); if (!rows.length) return null;
    const ids = new Set(rows.map((r) => r.channel_id));
    const since = Date.now() - 30 * 864e5;
    const all = (state.d.vids || []).filter((v) => v.platform === p && ids.has(v.channel_id)).sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
    const v30 = all.filter((v) => new Date(v.published_at) >= since);
    const views = v30.map((v) => v.views || 0);
    const sumV = views.reduce((a, b) => a + b, 0), eng = v30.reduce((a, v) => a + (v.likes || 0) + (v.comments || 0), 0);
    const ex = exclSet();
    const niche = (state.d.vids || []).filter((v) => v.platform === p && !ex.has(p + ":" + v.channel_id) && new Date(v.published_at) >= since).map((v) => v.views || 0);
    const lv = liveOf(p);
    const followers = lv?.followers ?? (rows.reduce((a, r) => a + (r.followers || 0), 0) || null);
    const h = getJSON("mystats", {})[p]?.h || [];
    const wk = h.filter((x) => x.d <= vnDay(Date.now() - 7 * 864e5)).pop() || h[0];
    const best = [...v30].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    return {
      rows, followers, lv, fDelta: lv?.d7 != null ? lv.d7 : followers != null && wk && wk.d !== vnDay(Date.now()) ? followers - wk.f : null, fHist: h.map((x) => x.f),
      n30: v30.length, sumV, med: median(views), eng: sumV ? (eng / sumV) * 100 : 0, nicheMed: median(niche), best, recent: all.slice(-12), last: all[all.length - 1],
    };
  }
  async function snapshotFollowers() {
    const ms = getJSON("mystats", {}); let changed = false; const today = vnDay(Date.now());
    for (const p of ["youtube", "tiktok"]) {
      const rows = mineOf(p); if (!rows.length) continue;
      const f = rows.reduce((a, r) => a + (r.followers || 0), 0); if (!f) continue;
      const o = (ms[p] ||= { h: [] }); const last = o.h[o.h.length - 1];
      if (last?.d === today) { if (last.f !== f) { last.f = f; changed = true; } }
      else { o.h.push({ d: today, f }); o.h = o.h.slice(-180); changed = true; }
    }
    if (changed) await saveJSON("mystats", ms);
  }
  const fDeltaTxt = (d) => d == null ? `<span class="delta flat">chưa đủ 7 ngày</span>` : `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : "flat"}">${d > 0 ? "+" : ""}${nf(d)} / 7 ngày</span>`;

  function fbStats() {
    const fb = getJSON("mystats", {}).facebook || { pages: [] };
    const all = fb.pages.map((pg) => { const h = pg.h || []; const l = h[h.length - 1], pv = h[h.length - 2]; return { name: pg.name, l, pv, hist: h.map((x) => x.f || 0), main: /chuy[eệ]n/i.test(pg.name || "") }; });
    if (!all.some((x) => x.main)) all.forEach((x) => (x.main = true));
    return all;
  }

  function renderMineMini() {
    const box = $("#mine-mini"); if (!box) return;
    const card = (p, body) => `<div class="panel kpi mini"><div class="top"><span class="ico" style="background:${PL[p].c}22;color:${PL[p].c}">${PL[p].ico}</span>${PL[p].n}</div>${body}</div>`;
    box.innerHTML = ["youtube", "tiktok"].map((p) => {
      const s = mineStats(p);
      const lv = liveOf(p); if (s && lv?.followers != null) { s.followers = lv.followers; if (lv.d7 != null) s.fDelta = lv.d7; }
      if (!s) return card(p, `<p class="muted" style="margin:4px 0 0;font-size:13px">Chưa liên kết kênh.</p><button class="btn sm" data-view="mine">Liên kết kênh</button>`);
      return card(p, `<div class="v num">${s.followers != null ? nf(s.followers) : "?"}<small>follow</small></div>
        <div class="foot">${s.recent.length > 1 ? spark(s.recent.map((v) => v.views || 0), PL[p].c) : '<span class="spark"></span>'}${fDeltaTxt(s.fDelta)}</div>
        <span class="muted" style="font-size:12px">View TB 30 ngày <b style="color:var(--text)">${short(s.med)}</b> · ngách ${short(s.nicheMed)} · ${s.n30} video</span>`);
    }).join("") + (() => {
      const allPg = fbStats(), pages = allPg.filter((x) => x.main), other = allPg.length - pages.length;
      if (!pages.length || !pages.some((x) => x.l)) return card("facebook", `<p class="muted" style="margin:4px 0 0;font-size:13px">Facebook chưa có API – nhập số tuần 1 lần.</p><button class="btn sm" id="fb-edit">Nhập số Facebook</button>`);
      const tot = pages.reduce((a, x) => a + (x.l?.f || 0), 0), totPv = pages.reduce((a, x) => a + (x.pv?.f || x.l?.f || 0), 0);
      const reach = pages.reduce((a, x) => a + (x.l?.reach || 0), 0);
      return card("facebook", `<div class="v num">${nf(tot)}<small>follow${pages.length > 1 ? ` · ${pages.length} page` : ""}</small></div>
        <div class="foot">${spark(pages[0].hist, PL.facebook.c)}<span class="delta ${tot - totPv > 0 ? "up" : tot - totPv < 0 ? "down" : "flat"}">${tot - totPv >= 0 ? "+" : ""}${nf(tot - totPv)} kỳ trước</span></div>
        <span class="muted" style="font-size:12px">Tiếp cận 7 ngày <b style="color:var(--text)">${short(reach)}</b> ${pages[0].l?.at ? ` · ${getJSON("mystats", {}).facebook?.auto ? "cập nhật" : "nhập"} ${agoTxt(pages[0].l.at)}` : ""}${other ? ` · +${other} page khác` : ""}</span>`);
    })();
  }

  function renderMine() {
    if (!state.d) return;
    $("#mine-note").textContent = "Đã kết nối: cập nhật 15 phút/lần · Chưa kết nối: quét số công khai lúc 6:00";
    const panel = (p) => {
      const s = mineStats(p), P = PL[p];
      const head = `<div class="ph"><h3 style="display:flex;align-items:center;gap:10px"><span class="ico" style="background:${P.c}22;color:${P.c}">${P.ico}</span>${P.n}</h3>`;
      if (!s) return `<div class="panel">${head}</div>
        <p class="muted">Nhập kênh ${P.n} của anh để Jarvis theo dõi chỉ số mỗi ngày.</p>
        <div class="row"><input id="mine-in-${p}" placeholder="${p === "youtube" ? "@tenkenh hoặc link kênh YouTube" : "@username TikTok"}" style="flex:1;min-width:180px"><button class="btn primary" data-mine-add="${p}">Liên kết</button></div></div>`;
      const vs = s.nicheMed ? s.med / s.nicheMed : 0;
      const maxV = Math.max(1, ...s.recent.map((v) => v.views || 0));
      return `<div class="panel">${head}${conns()[p]?.connected ? `<span class="cst ok"><i></i>LIVE</span>` : ""}<span class="muted" style="font-size:12.5px">${s.rows.map((r) => r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name || r.handle || r.channel_id)}</a>` : esc(r.handle || r.channel_id)).join(", ")}</span></div>
        <div class="bigf"><span class="num">${s.followers != null ? nf(s.followers) : "?"}</span> follow ${fDeltaTxt(s.fDelta)}</div>
        ${s.rows.some((r) => !r.channel_id) ? `<p class="muted" style="font-size:12.5px">Jarvis sẽ nhận diện kênh ở lần quét tới (6:00) hoặc khi anh bấm Quét số liệu ngay ở trang Đối thủ.</p>` : ""}
        <div class="sgrid">
          <div><span>Video 30 ngày</span><b>${s.n30}</b></div>
          <div><span>Tổng view 30 ngày</span><b>${short(s.sumV)}</b></div>
          <div><span>View TB / video</span><b>${short(s.med)}</b></div>
          <div><span>Tương tác</span><b>${dec(s.eng, 1)}%</b></div>
          <div><span>So với ngách</span><b class="${vs >= 1 ? "up" : "down"}">${vs ? "×" + dec(vs, vs < 1 ? 2 : 1) : "—"}</b></div>
          <div><span>Video gần nhất</span><b>${s.last ? fmt(s.last.published_at).replace(/, \d\d:\d\d$/, "") : "—"}</b></div>
        </div>
        ${s.recent.length ? `<h3 style="margin-top:16px">Lượt xem ${s.recent.length} video gần nhất</h3>
        <div class="vbars">${s.recent.map((v) => `<a class="vb" href="${esc(v.url)}" target="_blank" rel="noopener" style="height:${Math.max(3, ((v.views || 0) / maxV) * 100)}%;background:${(v.views || 0) >= s.nicheMed ? "var(--g)" : "#3A4A61"}" data-tip="${esc((v.title || "").slice(0, 70))} · ${nf(v.views)} view · ${durTxt(v.duration_s)}"></a>`).join("")}</div>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Cột xanh: video vượt trung vị ngách (${short(s.nicheMed)} view).</p>` : `<p class="muted">Chưa có video nào trong dữ liệu quét.</p>`}
        ${s.best ? `<p style="margin:12px 0 0;font-size:13px"><span class="muted">Video tốt nhất 30 ngày:</span> <a href="${esc(s.best.url)}" target="_blank" rel="noopener">${esc((s.best.title || "").slice(0, 80))}</a> · <b>${nf(s.best.views)}</b> view</p>` : ""}
        ${p === "youtube" ? ytDeepHtml(s.lv?.deep) : ttDeepHtml(s.lv?.deep)}
        ${conns()[p]?.connected ? "" : `<div class="row"><button class="btn sm danger" data-mine-unlink="${p}">Bỏ liên kết</button></div>`}</div>`;
    };
    const fb = fbStats();
    const fbPanel = `<div class="panel"><div class="ph"><h3 style="display:flex;align-items:center;gap:10px"><span class="ico" style="background:${PL.facebook.c}22;color:${PL.facebook.c}">${PL.facebook.ico}</span>Facebook</h3>${getJSON("mystats", {}).facebook?.auto ? "" : `<button class="btn sm" id="fb-edit">Nhập số tay</button>`}</div>
      <p class="muted" style="font-size:12.5px;margin-top:0">${getJSON("mystats", {}).facebook?.auto ? "Tự cập nhật qua Meta API (follow 15 phút/lần, tiếp cận và tương tác 3 giờ/lần). Tiếp cận = số người xem nội dung trong 7 ngày." : "Chưa kết nối Meta API: tạm nhập số tay từ Meta Business Suite › Thông tin chi tiết (1 phút/tuần)."}</p>
      ${fb.length && fb.some((x) => x.l) ? fb.map((x) => `<div class="fbp"><b>${esc(x.name)}</b>
        <div class="sgrid">
          <div><span>Follow</span><b>${nf(x.l?.f)}</b>${x.pv ? `<small class="${x.l.f - x.pv.f >= 0 ? "up" : "down"}">${x.l.f - x.pv.f >= 0 ? "+" : ""}${nf(x.l.f - x.pv.f)}</small>` : ""}</div>
          <div><span>Tiếp cận 7 ngày</span><b>${short(x.l?.reach)}</b>${x.pv?.reach ? `<small class="${x.l.reach >= x.pv.reach ? "up" : "down"}">${x.l.reach >= x.pv.reach ? "+" : ""}${dec(((x.l.reach - x.pv.reach) / x.pv.reach) * 100, 0)}%</small>` : ""}</div>
          <div><span>Tương tác 7 ngày</span><b>${short(x.l?.eng)}</b></div>
          <div><span>Bài đăng 7 ngày</span><b>${nf(x.l?.posts)}</b></div>
          <div><span>Tiếp cận / bài</span><b>${x.l?.posts ? short(x.l.reach / x.l.posts) : "—"}</b></div>
          <div><span>Cập nhật</span><b>${x.l?.at ? fmt(x.l.at).replace(/, \d\d:\d\d$/, "") : "—"}</b></div>
        </div>${x.hist.length > 1 ? `<div style="height:44px;margin-top:8px">${spark(x.hist, PL.facebook.c, 300, 44)}</div>` : ""}</div>`).join("")
        : `<div class="empty">Chưa có số. Bấm "Cập nhật số" để nhập cho 2 page.</div>`}</div>`;
    $("#mine-box").innerHTML = panel("youtube") + panel("tiktok") + fbPanel;
    $("#conn-box").innerHTML = connCards();
  }

  function openFB() {
    const fb = getJSON("mystats", {}).facebook || { pages: [] };
    const pages = fb.pages.length ? fb.pages : [{ name: "Page 1", h: [] }, { name: "Page 2", h: [] }];
    $("#detail-title").textContent = "Cập nhật số Facebook";
    $("#detail-body").innerHTML = `<p class="muted" style="white-space:normal">Lấy từ Meta Business Suite › Thông tin chi tiết, chọn 7 ngày qua.</p>` + pages.map((pg, i) => {
      const l = (pg.h || [])[pg.h?.length - 1] || {};
      return `<div class="fbform" data-fbi="${i}"><label>Tên page<input data-k="name" value="${esc(pg.name)}"></label>
        <div class="f4"><label>Người theo dõi<input data-k="f" type="number" min="0" value="${l.f ?? ""}"></label>
        <label>Tiếp cận 7 ngày<input data-k="reach" type="number" min="0" value=""></label>
        <label>Tương tác 7 ngày<input data-k="eng" type="number" min="0" value=""></label>
        <label>Bài đăng 7 ngày<input data-k="posts" type="number" min="0" value=""></label></div></div>`;
    }).join("");
    $("#detail-actions").innerHTML = `<button class="btn primary" id="fb-save">Lưu số tuần này</button><button class="btn" id="fb-addpage">+ Thêm page</button>`;
    $("#detail").showModal();
  }

  // ======================= MỤC TIÊU TUẦN =======================
  const isSunVN = () => new Date(new Date().toLocaleString("en-US", { timeZone: TZ })).getDay() === 0;
  const baseWk = () => (isSunVN() ? 1 : 0);
  state.wk = baseWk();
  function weekStart(off) {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + off * 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const wkRange = (k) => { const a = new Date(`${k}T00:00:00+07:00`).getTime(); return [a, a + 7 * 864e5]; };
  const wkLabel = (k) => { const [a, b] = wkRange(k); const f = (t) => new Date(t).toLocaleDateString("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit" }); return `${f(a)} – ${f(b - 864e5)}`; };
  const AUTO = { "": "Không tự đếm", yt: "Tự đếm: video YouTube của tôi", tt: "Tự đếm: video TikTok của tôi", scripts: "Tự đếm: kịch bản đã duyệt", jarvis: "Tự đếm: việc Jarvis làm xong" };
  function autoCount(g, k) {
    if (!g.auto) return 0;
    const [a, b] = wkRange(k); const inW = (t) => { const x = new Date(t).getTime(); return x >= a && x < b; };
    if (g.auto === "yt" || g.auto === "tt") {
      const p = g.auto === "yt" ? "youtube" : "tiktok"; const ids = new Set(mineOf(p).map((r) => r.channel_id));
      return (state.d?.vids || []).filter((v) => v.platform === p && ids.has(v.channel_id) && inW(v.published_at)).length;
    }
    if (g.auto === "scripts") return state.approvals.filter((x) => x.kind === "script" && x.status === "approved" && x.decided_at && inW(x.decided_at)).length;
    if (g.auto === "jarvis") return (state.d?.jobs || []).filter((j) => j.ok && inW(j.at)).length;
    return 0;
  }
  const gDone = (g, k) => Math.max(g.done || 0, autoCount(g, k));
  const gPct = (g, k) => g.checked ? 100 : g.target ? Math.min(100, Math.round((gDone(g, k) / g.target) * 100)) : 0;
  const goalsAll = () => getJSON("goals", {});
  const TEMPLATE = [
    { title: "Đăng video TikTok", target: 4, unit: "video", auto: "tt" },
    { title: "Đăng video YouTube (dài hoặc Shorts)", target: 2, unit: "video", auto: "yt" },
    { title: "Đăng bài lên 2 page Facebook", target: 5, unit: "bài", auto: "" },
    { title: "Duyệt kịch bản Jarvis viết", target: 2, unit: "kịch bản", auto: "scripts" },
    { title: "Quay footage 1 chuyến hoặc 1 sản phẩm review", target: 1, unit: "buổi", auto: "" },
    { title: "Trả lời bình luận, inbox", target: 7, unit: "ngày", auto: "" },
  ];
  async function setGoals(k, list) { const all = goalsAll(); all[k] = list; await saveJSON("goals", all); }

  function goalRows(list, k, compact) {
    return list.map((g) => {
      const p = gPct(g, k), d = gDone(g, k);
      return `<div class="grow ${g.checked || p >= 100 ? "done" : ""}">
        <button class="chk" data-gchk="${g.id}" aria-pressed="${!!g.checked}" aria-label="Đánh dấu xong">${g.checked ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg>' : ""}</button>
        <span class="gt">${g.src === "ai" ? '<i class="aitag">AI</i>' : ""}${esc(g.title)}${g.auto && !compact ? `<small>${AUTO[g.auto].replace("Tự đếm: ", "tự đếm ")}</small>` : ""}${g.why && !compact ? `<em>${esc(g.why)}</em>` : ""}</span>
        ${compact ? "" : `<span class="gstep">${g.target ? `<button class="btn sm" data-gstep="${g.id}:-1" aria-label="Bớt">−</button><b class="num">${d}/${g.target}</b><button class="btn sm" data-gstep="${g.id}:1" aria-label="Thêm">+</button><small>${esc(g.unit || "")}</small>` : `<small class="muted">đánh dấu khi xong</small>`}</span>`}
        <span class="gp"><span class="track"><i style="width:${p}%;background:${p >= 100 ? "var(--g)" : p >= 50 ? "var(--blue)" : "var(--amber)"}"></i></span><b class="num">${p}%</b></span>
        ${compact ? "" : `<button class="btn sm danger gdel" data-gdel="${g.id}" aria-label="Xóa">✕</button>`}
      </div>`;
    }).join("");
  }
  function overall(list, k) { return list.length ? Math.round(list.reduce((a, g) => a + gPct(g, k), 0) / list.length) : 0; }

  function renderGoals() {
    const k = weekStart(state.wk), list = goalsAll()[k] || [];
    $("#wk-label").textContent = (state.wk === 0 ? "Tuần này · " : state.wk === 1 ? "Tuần sau · " : "") + wkLabel(k);
    const o = overall(list, k), done = list.filter((g) => gPct(g, k) >= 100).length;
    $("#goals-box").innerHTML = planPanel(k) + `
      <div class="panel gsum"><div class="ring" style="--p:${o}"><b class="num">${o}%</b></div>
        <div><b style="font-size:17px">${list.length ? `${done}/${list.length} mục tiêu đã xong` : "Chưa có mục tiêu tuần này"}</b>
        <p class="muted" style="margin:4px 0 0">% hoàn thành = số đã làm ÷ chỉ tiêu. Mục có "tự đếm" sẽ tự cập nhật từ số liệu kênh và Jarvis.</p></div></div>
      <div class="panel" style="margin-top:14px">
        <div class="ghead"><span></span><span>Mục tiêu</span><span>Tiến độ</span><span>% hoàn thành</span><span></span></div>
        ${list.length ? goalRows(list, k) : `<div class="empty">Tuần này chưa có mục tiêu.<div class="row" style="justify-content:center"><button class="btn primary" id="g-template">Dùng mẫu gợi ý</button><button class="btn" id="g-copy">Chép từ tuần trước</button></div></div>`}
        <div class="gadd">
          <input id="g-title" placeholder="Thêm mục tiêu, ví dụ: Đăng 3 video Shorts">
          <input id="g-target" type="number" min="0" placeholder="Chỉ tiêu">
          <input id="g-unit" placeholder="Đơn vị">
          <select id="g-auto">${Object.entries(AUTO).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
          <button class="btn primary" id="g-add">Thêm</button>
        </div>
      </div>`;
  }
  function renderGoalMini() {
    const box = $("#goal-mini"); if (!box) return;
    const k = weekStart(baseWk()), list = goalsAll()[k] || [];
    if (!list.length) return (box.innerHTML = `<div class="empty" style="padding:20px">Chưa đặt mục tiêu tuần này. <a href="#" data-go="goals">Đặt ngay</a></div>`);
    const o = overall(list, k);
    box.innerHTML = `<div class="gmini-top"><div class="ring sm" style="--p:${o}"><b class="num">${o}%</b></div><span class="muted">${wkLabel(k)} · ${list.filter((g) => gPct(g, k) >= 100).length}/${list.length} xong</span></div>` + goalRows(list.slice(0, 6), k, true);
  }


  // Kế hoạch nội dung Jarvis đề xuất cho tuần
  const PLN = { tiktok: "TikTok", youtube: "YouTube", youtube_shorts: "Shorts", facebook: "Facebook" };
  function planPanel(k) {
    const p = getJSON("weekly_plan", {})[k];
    const task = state.tasks.find((t) => t.kind === "weekly_goals");
    const running = task?.last_status === "running";
    const btn = task ? `<button class="btn ${p ? "sm" : "primary"}" data-run="${task.id}" ${running ? "disabled" : ""}>${running ? "Jarvis đang lập kế hoạch… (1–2 phút)" : p ? "Lập lại" : "Jarvis lập kế hoạch tuần này"}</button>` : "";
    if (!p) return `<div class="panel plan"><div class="ph"><h3>Kế hoạch Jarvis đề xuất</h3>${btn}</div>
      <p class="muted" style="margin:0">Jarvis đọc số liệu thật của kênh anh, của ngách và trend tuần này để đề xuất 5–7 video dễ lên xu hướng, rồi tự tạo mục tiêu tuần bên dưới. Tự chạy mỗi tối Chủ nhật lúc 20:30.</p></div>`;
    return `<div class="panel plan"><div class="ph"><h3>Kế hoạch Jarvis đề xuất · ${fmt(p.at)}</h3>${btn}</div>
      <p class="plan-sum">${esc(p.summary)}</p>
      <div class="plan-grid">${(p.content || []).map((c, i) => `<div class="pc">
        <div class="pc-h"><span class="tag" style="color:${PL[c.platform === "youtube_shorts" ? "youtube" : c.platform]?.c || "inherit"}">${PLN[c.platform] || esc(c.platform)}</span><span class="muted">${esc(c.day || "")} · ${esc(c.duration || "")}</span></div>
        <b>${esc(c.title)}</b>
        ${c.hook ? `<span class="pc-hook">“${esc(c.hook)}”</span>` : ""}
        <span class="muted pc-why">${esc(c.why || "")}</span>
        <div class="pc-f"><span class="muted">${esc(c.format || "")}${c.effort ? " · " + esc(c.effort) : ""}</span>
          ${c.evidence && /^https?:/.test(c.evidence) ? `<a href="${esc(c.evidence)}" target="_blank" rel="noopener">Nguồn</a>` : ""}
          <button class="btn sm primary" data-planmake="${k}:${i}">Làm video này</button></div>
      </div>`).join("")}</div></div>`;
  }
  function openPlanMake(key) {
    const [k, i] = key.split(":"); const c = getJSON("weekly_plan", {})[k]?.content?.[+i]; if (!c) return;
    $("#detail-title").textContent = "Làm video theo kế hoạch tuần";
    $("#detail-body").innerHTML = `<p class="muted" style="white-space:normal">Sửa phần trải nghiệm thật cho đúng rồi gửi. Jarvis sẽ viết kịch bản và đưa vào Hộp duyệt.</p><textarea id="idea-text" rows="11">Video theo kế hoạch tuần Jarvis đề xuất:
- Tiêu đề: ${c.title}
- Nền tảng: ${PLN[c.platform] || c.platform} · Độ dài: ${c.duration} · Đăng: ${c.day}
- Định dạng: ${c.format}
- Hook gợi ý: ${c.hook}
- Vì sao làm: ${c.why}
${c.evidence ? "- Nguồn tham khảo: " + c.evidence : ""}

Trải nghiệm thật của mình (anh sửa lại): đã đi / đã dùng ... ; con số thật: ... km, ... tiền, ... giờ.</textarea>`;
    $("#detail-actions").innerHTML = '<button class="btn primary" id="idea-send">Gửi cho Jarvis viết kịch bản</button>';
    $("#detail").showModal();
  }
  // ======================= VIDEO HOT =======================
  state.hotp = "all";
  function hotList(p) {
    const ex = exclSet(), hid = new Set(getJSON("hot_hidden", []));
    const since = Date.now() - 21 * 864e5;
    return (state.d?.vids || []).filter((v) => (p === "all" || v.platform === p) && !ex.has(v.platform + ":" + v.channel_id) && !hid.has(v.platform + ":" + v.video_id) && new Date(v.published_at) >= since && (v.views || 0) > 0)
      .map((v) => { const vpd = (v.views || 0) / ago(v.published_at); const x = v.followers ? v.views / v.followers : 0; return { ...v, vpd, x, score: vpd * (x >= 3 ? 1.6 : 1) }; })
      .sort((a, b) => b.score - a.score).slice(0, 30);
  }
  const hotCard = (v, i, compact) => `
    <article class="card hot">
      <span class="rank">${i + 1}</span>
      <div class="body">
        <span class="title"><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc((v.title || "(không tiêu đề)").slice(0, compact ? 80 : 130))}</a></span>
        <span class="meta"><span class="tag" style="color:${PL[v.platform].c}">${PL[v.platform].n}</span>${esc(v.channel_name || "")} · <b style="color:var(--text)">${short(v.views)}</b> view · <b class="up">${short(v.vpd)}/ngày</b>${compact ? "" : ` · ${durTxt(v.duration_s)} · đăng ${fmt(v.published_at).replace(/, \d\d:\d\d$/, "")}`}${v.x >= 3 ? ` <span class="pill-s">Vượt mặt ×${dec(v.x, 1)}</span>` : ""}</span>
      </div>
      ${compact ? `<button class="btn sm" data-hotmake="${v.platform}:${v.video_id}">Làm</button>` : `<div class="hot-act"><button class="btn sm primary" data-hotmake="${v.platform}:${v.video_id}">Làm video này</button><button class="btn sm" data-hothide="${v.platform}:${v.video_id}">Bỏ qua</button></div>`}
    </article>`;
  function renderHot() {
    const list = hotList(state.hotp);
    const idea = state.approvals.find((a) => a.kind === "ideas" && /^Ý tưởng video tuần/.test(a.title));
    $("#hot-ideas").innerHTML = idea ? `<div class="banner"><span><b>${esc(idea.title)}</b> · Jarvis đã đề xuất dựa trên số liệu ngách</span><button class="btn sm" data-open="${idea.id}">Xem ý tưởng</button></div>` : "";
    $("#hot-list").innerHTML = list.length ? list.map((v, i) => hotCard(v, i)).join("") : `<div class="empty">Chưa có video ngách 21 ngày qua. Bấm "Quét số liệu ngay" ở trang Đối thủ.</div>`;
  }
  function renderHotMini() {
    const box = $("#hot-mini"); if (!box) return;
    const list = hotList("all").slice(0, 4);
    box.innerHTML = list.length ? `<div class="list">${list.map((v, i) => hotCard(v, i, true)).join("")}</div>` : `<div class="empty" style="padding:20px">Chưa có số liệu.</div>`;
  }
  function openHotMake(key) {
    const [p, id] = key.split(":");
    const v = (state.d?.vids || []).find((x) => x.platform === p && x.video_id === id); if (!v) return;
    const days = Math.round(ago(v.published_at)), x = v.followers ? v.views / v.followers : 0;
    $("#detail-title").textContent = "Làm video từ chủ đề hot";
    $("#detail-body").innerHTML = `<p class="muted" style="white-space:normal">Sửa phần "Góc của mình" cho đúng trải nghiệm thật của anh, rồi gửi. Jarvis sẽ viết kịch bản và đưa vào Hộp duyệt.</p><textarea id="idea-text" rows="11">Làm phiên bản Chuyện của Thắng dựa trên video đang hot trong ngách:
- Video gốc: ${v.title || ""}
- Link: ${v.url}
- Kênh: ${v.channel_name || ""} · ${nf(v.views)} view sau ${days} ngày (${nf(Math.round(v.views / Math.max(1, days)))} view/ngày)${x >= 3 ? ` · gấp ${dec(x, 1)} lần số follow` : ""}
- Độ dài: ${durTxt(v.duration_s)} · Nền tảng: ${PL[p].n}

Góc của mình (anh sửa lại): mình đã đi / đã dùng ... ; con số thật: ... km, ... tiền, ... giờ.
Không chép nội dung video gốc, chỉ học cách đặt vấn đề và độ dài.</textarea>`;
    $("#detail-actions").innerHTML = '<button class="btn primary" id="idea-send">Gửi cho Jarvis viết kịch bản</button>';
    $("#detail").showModal();
  }

  // ======================= SỰ KIỆN MỚI =======================
  async function extraClick(el) {
    const ds = el.dataset;
    if (el.id === "fb-edit") { openFB(); return true; }
    if (el.id === "fb-addpage") { const n = $$(".fbform").length; $("#detail-body").insertAdjacentHTML("beforeend", `<div class="fbform" data-fbi="${n}"><label>Tên page<input data-k="name" value="Page ${n + 1}"></label><div class="f4"><label>Người theo dõi<input data-k="f" type="number" min="0"></label><label>Tiếp cận 7 ngày<input data-k="reach" type="number" min="0"></label><label>Tương tác 7 ngày<input data-k="eng" type="number" min="0"></label><label>Bài đăng 7 ngày<input data-k="posts" type="number" min="0"></label></div></div>`); return true; }
    if (el.id === "fb-save") {
      const ms = getJSON("mystats", {}); const old = ms.facebook?.pages || [];
      const pages = $$(".fbform").map((f, i) => {
        const g = (k) => f.querySelector(`[data-k="${k}"]`).value.trim();
        const pg = { name: g("name") || `Page ${i + 1}`, h: [...(old[i]?.h || [])] };
        if (g("f") !== "") {
          const e = { d: vnDay(Date.now()), at: new Date().toISOString(), f: +g("f"), reach: +g("reach") || 0, eng: +g("eng") || 0, posts: +g("posts") || 0 };
          if (pg.h.length && pg.h[pg.h.length - 1].d === e.d) pg.h[pg.h.length - 1] = e; else pg.h.push(e);
          pg.h = pg.h.slice(-60);
        }
        return pg;
      });
      ms.facebook = { ...(ms.facebook || {}), pages }; await saveJSON("mystats", ms);
      $("#detail").close(); renderMine(); renderMineMini(); return true;
    }
    if (ds.mineAdd) {
      const p = ds.mineAdd, v = $(`#mine-in-${p}`).value.trim(); if (!v) return true;
      const comps = state.d?.comps || [];
      let row, match;
      if (p === "youtube") {
        const m = v.match(/youtube\.com\/channel\/(UC[\w-]+)/), h = v.match(/@([\w.\-]+)/), hd = h ? h[1] : v.replace(/^@/, "");
        match = comps.find((c) => c.platform === p && ((m && c.channel_id === m[1]) || (!m && (c.handle || "").toLowerCase() === "@" + hd.toLowerCase())));
        row = m ? { channel_id: m[1], url: v } : { handle: "@" + hd, url: "https://www.youtube.com/@" + hd };
      } else {
        const h = v.match(/@([\w.\-]+)/), u = h ? h[1] : v.replace(/^@/, "");
        match = comps.find((c) => c.platform === p && (c.channel_id || "").toLowerCase() === u.toLowerCase());
        row = { channel_id: u, handle: "@" + u, url: "https://www.tiktok.com/@" + u, name: "@" + u };
      }
      const { error } = match ? await sb.from("competitors").update({ status: "mine" }).eq("id", match.id)
        : await sb.from("competitors").insert({ platform: p, source: "manual", status: "mine", ...row });
      if (error) { alertBox("Không liên kết được", error.message); return true; }
      await loadDash(); renderMine();
      alertBox("Đã liên kết kênh", match?.channel_id ? "Jarvis đã có sẵn số liệu kênh này và sẽ cập nhật mỗi sáng 6:00." : "Jarvis sẽ lấy số liệu kênh ở lần quét tới (6:00 sáng), hoặc anh bấm \"Quét số liệu ngay\" ở trang Đối thủ & Số liệu.");
      return true;
    }
    if (ds.mineUnlink) {
      const ids = mineOf(ds.mineUnlink).map((r) => r.id);
      if (ids.length) await sb.from("competitors").update({ status: "ignored" }).in("id", ids);
      await loadDash(); renderMine(); return true;
    }
    if (ds.wk) { state.wk += +ds.wk; renderGoals(); return true; }
    const k = weekStart(state.wk);
    if (ds.gchk || ds.gstep || ds.gdel) {
      const isMini = !!el.closest("#goal-mini"); const key = isMini ? weekStart(baseWk()) : k;
      const list = [...(goalsAll()[key] || [])];
      const id = (ds.gchk || ds.gstep || ds.gdel).split(":")[0];
      const g = list.find((x) => x.id === id); if (!g) return true;
      if (ds.gchk) g.checked = !g.checked;
      if (ds.gstep) { const step = +ds.gstep.split(":")[1]; g.done = Math.max(0, gDone(g, key) + step); if (g.target && g.done >= g.target && step > 0) g.checked = true; if (step < 0) g.checked = false; }
      if (ds.gdel) list.splice(list.indexOf(g), 1);
      await setGoals(key, list); renderGoals(); renderGoalMini(); return true;
    }
    if (el.id === "g-add") {
      const title = $("#g-title").value.trim(); if (!title) { $("#g-title").focus(); return true; }
      const list = [...(goalsAll()[k] || []), { id: Math.random().toString(36).slice(2, 9), title, target: Number($("#g-target").value) || 0, unit: $("#g-unit").value.trim(), auto: $("#g-auto").value, done: 0, checked: false }];
      await setGoals(k, list); renderGoals(); renderGoalMini(); return true;
    }
    if (el.id === "g-template") { await setGoals(k, TEMPLATE.map((t) => ({ ...t, id: Math.random().toString(36).slice(2, 9), done: 0, checked: false }))); renderGoals(); renderGoalMini(); return true; }
    if (el.id === "g-copy") {
      const prev = goalsAll()[weekStart(state.wk - 1)] || [];
      if (!prev.length) { alertBox("Tuần trước chưa có mục tiêu", "Bấm \"Dùng mẫu gợi ý\" để bắt đầu."); return true; }
      await setGoals(k, prev.map((g) => ({ ...g, id: Math.random().toString(36).slice(2, 9), done: 0, checked: false }))); renderGoals(); renderGoalMini(); return true;
    }
    if (ds.hotp) { state.hotp = ds.hotp; $$("[data-hotp]").forEach((b) => b.classList.toggle("active", b === el)); renderHot(); return true; }
    if (ds.hotmake) { openHotMake(ds.hotmake); return true; }
    if (ds.planmake) { openPlanMake(ds.planmake); return true; }
    if (ds.hothide) { const h = getJSON("hot_hidden", []); h.push(ds.hothide); await saveJSON("hot_hidden", h.slice(-500)); renderHot(); renderHotMini(); return true; }
    return false;
  }

  // ======================= SẢN XUẤT =======================
  const STG = [["kich_ban", "Kịch bản"], ["dung", "Anh tự dựng"], ["dong_goi", "Đóng gói"], ["len_lich", "Lên lịch"], ["da_dang", "Đã đăng"]];
  const STN = Object.fromEntries(STG);
  const VT = { roadtrip_short: ["Roadtrip ngắn", "#2BD982"], roadtrip_long: ["Roadtrip dài", "#4C8DFF"], review: ["Review affiliate", "#F5B544"] };
  const PLAT = [["tiktok", "TikTok"], ["youtube_shorts", "YouTube Shorts"], ["youtube", "YouTube (dài)"], ["facebook", "Facebook Reels"]];
  state.prods = []; state.pstage = "kich_ban"; state.driveLocs = null;

  async function loadProd() {
    const { data, error } = await sb.from("productions").select("*").order("updated_at", { ascending: false }).limit(300);
    if (!error) { state.prods = data || []; watchProd(state.prods); }
    renderProdBadge();
    livePipe();
  }
  function renderProdBadge() {
    const n = state.prods.filter((p) => p.stage === "dong_goi").length;
    $$(".badge-prod").forEach((b) => { b.textContent = n; b.classList.toggle("hidden", !n); });
  }
  const nextHint = (p) => ({
    kich_ban: p.script_id ? "Đã có kịch bản · chuyển sang Anh tự dựng" : "Chưa gắn kịch bản",
    dung: p.final_file_id ? "Đã có video hoàn thiện" : "Dựng trên máy tính · xong tải lên Drive 06_VIDEO_HOAN_THIEN",
    dong_goi: "Jarvis đang viết tiêu đề và lên lịch (mỗi giờ 7h–23h)",
    len_lich: p.scheduled_at ? `Lên lịch ${fmt(p.scheduled_at)}${p.package?.posts?.length ? ` · ${p.package.posts.length} nền tảng` : ""}` : "Chưa đặt giờ đăng",
    da_dang: p.scheduled_at ? `Đã đăng ${fmt(p.scheduled_at)}` : "Đã đăng",
  }[p.stage] || "");
  function pipeHint(p) {
    const st = p.pipe?.status;
    if (st === "running") return `⚙️ Đang ${p.pipe.mode === "transcribe" ? "chép lời" : "dựng"} ${p.pipe.pct ?? 0}%${p.pipe.step ? ` · ${p.pipe.step}` : ""}`;
    if (st === "transcript") return "📝 Đã chép lời · mở để sửa và duyệt lời thoại";
    if (st === "queued" && p.pipe.mode === "transcribe") return "⏳ Chờ máy chép lời (tự chạy mỗi giờ 7h–23h)";
    if (st === "error") return `⚠️ Máy dựng lỗi · mở để dựng lại`;
    if (st === "done") return "Có bản dựng · chuyển sang Duyệt";
    return "⏳ Chờ máy dựng (tự chạy mỗi giờ 7h–23h)";
  }
  const vtTag = (t) => { const v = VT[t] || [t, "var(--muted)"]; return `<span class="tag" style="color:${v[1]};border-color:${v[1]}55">${esc(v[0])}</span>`; };
  const prodCard = (p) => `<button class="pcard" data-prod="${p.id}">
      <span class="pc-t">${esc(p.title)}</span>
      <span class="pc-m">${vtTag(p.vtype)}${p.location ? `<span class="muted">📍 ${esc(p.location)}</span>` : ""}</span>
      <span class="pc-h ${p.pipe?.status === "error" || p.audit?.verdict === "fix" ? "status-error" : ""}">${esc(nextHint(p))}</span>
      ${p.pipe?.status === "running" && p.stage === "dung" ? pbar(p) : ""}
      <span class="pc-d muted">${fmt(p.updated_at)}</span></button>`;

  function freeScripts() {
    const used = new Set(state.prods.map((p) => p.script_id).filter(Boolean));
    return state.approvals.filter((a) => a.kind === "script" && a.status === "approved" && !used.has(a.id));
  }
  function renderProd() {
    const box = $("#prod-box"); if (!box) return;
    const by = Object.fromEntries(STG.map(([k]) => [k, []]));
    for (const p of state.prods) (by[p.stage] ||= []).push(p);
    const fs = freeScripts();
    const banner = fs.length ? `<div class="banner prod-banner"><span>${fs.length} kịch bản đã duyệt chưa vào sản xuất</span><div class="row" style="margin:0">${fs.slice(0, 3).map((a) => `<button class="btn sm" data-pfrom="${a.id}">+ ${esc(a.title.replace(/^Kịch bản:\s*/i, "").slice(0, 40))}</button>`).join("")}</div></div>` : "";
    const chips = `<div class="chips pchips">${STG.map(([k, n]) => `<button class="chip ${state.pstage === k ? "active" : ""}" data-pst="${k}">${n} <b>${by[k].length}</b></button>`).join("")}</div>`;
    const cols = `<div class="kanban">${STG.map(([k, n]) => `<div class="kcol ${state.pstage === k ? "on" : ""}" data-col="${k}"><div class="kh"><span>${n}</span><b>${by[k].length}</b></div>
      <div class="kbody">${by[k].length ? by[k].map(prodCard).join("") : `<div class="kempty">Trống</div>`}</div></div>`).join("")}</div>`;
    box.innerHTML = banner + chips + cols;
  }

  async function loadDriveLocs(force) {
    if (state.driveLocs && !force) return state.driveLocs;
    try { state.driveLocs = await callRunner({ drive_locations: true }); } catch (e) { state.driveLocs = { error: String(e.message || e) }; }
    return state.driveLocs;
  }
  function locOptions(p) {
    const d = state.driveLocs;
    if (!d) return `<button class="btn sm" id="p-loadloc" type="button">Tải danh sách địa điểm từ Drive</button>`;
    if (d.error) return `<p class="err" style="white-space:normal;margin:4px 0">${esc(d.msg || d.error)}</p>${d.error === "need_drive" ? `<button class="btn sm" data-view="mine" type="button">Mở Kết nối tài khoản</button>` : ""}`;
    if (!d.locations?.length) return `<p class="muted" style="white-space:normal;margin:4px 0">Chưa có địa điểm nào trong 03_FOOTAGE. Tạo bản sao thư mục _MẪU, đổi tên theo địa điểm và tải footage lên.</p>${d.footage_url ? `<a href="${esc(d.footage_url)}" target="_blank" rel="noopener">Mở thư mục footage</a>` : ""}`;
    return `<select id="p-loc"><option value="">— Chọn địa điểm —</option>${d.locations.map((l) => `<option value="${esc(l.id)}" ${p.drive_folder_id === l.id ? "selected" : ""}>${esc(l.name)} · ${l.total} clip (${l.subs.map((s) => `${esc(s.name.replace(/^roadtrip video /, ""))} ${s.count}`).join(", ")})</option>`).join("")}</select>`;
  }

  function promptFor(p) {
    const sc = state.approvals.find((a) => a.id === p.script_id);
    const loc = p.location ? `Footage trên Drive: Studio Chuyện Của Thắng/03_FOOTAGE/${p.location}` : "Footage: (chưa chọn)";
    const script = sc ? `\n\nKịch bản đã duyệt:\n${sc.body}` : "";
    const mode = p.vtype === "roadtrip_long" ? "chế độ Điện ảnh" : "chế độ Short";
    if (p.stage === "kich_ban" || p.stage === "dung") {
      if (p.vtype === "review") return `Đọc skill quy-dinh-dung-video rồi dùng skill review-affiliate-video dựng video "${p.title}". ${loc}/review sản phẩm. Xuất bản 9:16 và 16:9, báo tên project CapCut và file xuất.${script}`;
      return `Đọc skill quy-dinh-dung-video rồi dùng skill roadtrip-edit (${mode}) dựng video "${p.title}". ${loc}/${p.vtype === "roadtrip_long" ? "roadtrip video ngang" : "roadtrip video dọc"}. Lập bảng dựng cho tôi duyệt trước, rồi dựng vào CapCut và báo tên project.${script}`;
    }
    if (p.stage === "duyet") return `Dùng skill duyet-video-roadtrip duyệt bản dựng video "${p.title}" (${VT[p.vtype]?.[0] || p.vtype}, ${mode})${p.output_url ? `, bản xuất: ${p.output_url}` : ""}. Lập biên bản lỗi có mốc thời gian, kết luận đăng được chưa.`;
    if (p.stage === "len_lich" || p.stage === "da_dang") {
      const pk = p.package?.text ? `\n\nGói đăng (tiêu đề, mô tả, hashtag theo từng nền tảng):\n${p.package.text}` : "\n\n(Chưa có gói đăng: dùng skill dong-goi-dang-bai viết trước.)";
      return `Dùng skill len-lich-dang-bai lên lịch trên Metricool video "${p.title}" (${VT[p.vtype]?.[0] || p.vtype}). File video: ${p.output_url || "(chưa có link)"}. Nền tảng: ${p.platforms.map((x) => (PLAT.find((y) => y[0] === x) || [x, x])[1]).join(", ")}. Giờ đăng: ${p.scheduled_at ? fmt(p.scheduled_at) + " (giờ VN)" : "chọn giờ vàng gần nhất"}.${pk}`;
    }
    if (p.stage === "dong_goi") return `Dùng skill dong-goi-dang-bai đóng gói video "${p.title}" (${VT[p.vtype]?.[0] || p.vtype}) cho ${p.platforms.map((x) => (PLAT.find((y) => y[0] === x) || [x, x])[1]).join(", ")}: tiêu đề, mô tả, thẻ, hashtag, ảnh bìa dọc và ngang trên Canva.${script}`;
    return "";
  }
  const STEP_GUIDE = {
    kich_ban: "Gắn kịch bản đã duyệt rồi chuyển sang Anh tự dựng.",
    dung: "Anh dựng trên máy tính. Xong xuất video và tải lên Drive, thư mục 06_VIDEO_HOAN_THIEN (đặt tên file bắt đầu bằng mã video, ví dụ 001-ten-video.mp4, để Jarvis gắn đúng thẻ này). Jarvis tự nhận video và chuyển sang Đóng gói.",
    dong_goi: "Mỗi giờ (7h–23h) Jarvis xem thư mục 06_VIDEO_HOAN_THIEN: tự đặt lịch Facebook giờ vàng (video được ưu tiên, bài ảnh tự lùi sang khung sau) và viết sẵn tiêu đề, mô tả, hashtag TikTok/YouTube để anh tự đăng.",
    len_lich: "Facebook đã lên lịch trên Metricool. TikTok và YouTube: copy gợi ý bên trên rồi anh tự đăng, xong bấm chuyển sang Đã đăng.",
    da_dang: "Video đã đăng. Số liệu sẽ hiện ở Chỉ số nền tảng.",
  };
  // Giờ vàng lấy từ Metricool (giờ VN); settings "best_times" ghi đè nếu có
  const BEST_DEF = { tiktok: { hours: [10, 12, 18], days: [3, 4, 2, 5, 1, 6, 0] }, youtube_shorts: { hours: [16, 10], days: [3, 4, 2, 5, 1, 6, 0] }, youtube: { hours: [16], days: [3, 4, 2, 5, 1, 6, 0] }, facebook: { hours: [10, 12], days: [1, 2, 3, 5, 4, 6, 0] } };
  function suggestSlot(p) {
    const best = { ...BEST_DEF, ...getJSON("best_times", {}) };
    const main = (p.platforms || []).find((x) => best[x]) || "tiktok";
    const b = best[main];
    const taken = state.prods.filter((x) => x.id !== p.id && x.scheduled_at && ["len_lich", "da_dang"].includes(x.stage)).map((x) => new Date(x.scheduled_at).getTime());
    const nowVN = Date.now() + 7 * 36e5, minT = Date.now() + 3 * 36e5;
    const cands = [];
    for (let d = 0; d < 8; d++) {
      const day = new Date(nowVN + d * 864e5); const dow = day.getUTCDay();
      for (const h of b.hours) {
        const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h) - 7 * 36e5;
        if (t < minT || taken.some((x) => Math.abs(x - t) < 4 * 36e5)) continue;
        cands.push({ t, score: d * 10 + b.days.indexOf(dow) * 2 + b.hours.indexOf(h) });
      }
    }
    cands.sort((a, c) => a.score - c.score);
    return cands[0] ? { at: new Date(cands[0].t).toISOString(), net: main } : null;
  }
  function pbar(p, big) {
    const pct = Math.max(0, Math.min(100, Number(p.pipe?.pct ?? 0)));
    const started = p.pipe?.started || p.pipe?.at;
    const mins = started ? Math.max(0, Math.round((Date.now() - new Date(started).getTime()) / 60000)) : 0;
    const eta = pct >= 5 && mins > 0 ? Math.max(1, Math.round(mins * (100 - pct) / pct)) : null;
    return `<span class="pbar ${big ? "big" : ""}"><i style="width:${pct}%"></i></span>${big ? `<span class="muted" style="font-size:12px">${pct}% · đã chạy ${mins} phút${eta ? ` · còn khoảng ${eta} phút` : ""}</span>` : ""}`;
  }
  // Theo dõi máy dựng: cập nhật tại chỗ và báo khi xong/lỗi
  const pipeSeen = new Map(); let pipeTimer = null;
  function watchProd(rows) {
    for (const p of rows) {
      const prev = pipeSeen.get(p.id); const st = p.pipe?.status;
      if (prev && prev !== st) {
        if (prev === "running" && st === "done") notify(`🎬 Dựng xong: ${p.title}`, p.audit?.verdict === "pass" ? "Tự duyệt đạt. Mở để xem bản dựng." : "Đã có bản dựng, mở để xem và duyệt.", p.id);
        if (st === "transcript") notify(`📝 Đã chép lời: ${p.title}`, "Mở để sửa lời thoại, gạch câu hỏng rồi duyệt để dựng.", p.id);
        if (st === "error") notify(`⚠️ Máy dựng lỗi: ${p.title}`, String(p.pipe?.error || "").split("Log:")[0].slice(0, 160), p.id, true);
      }
      pipeSeen.set(p.id, st || "none");
    }
    // cập nhật khung tiến trình trong chi tiết đang mở mà không xoá chữ anh đang gõ
    const box = $("#p-pipebox");
    if (box && state.pedit?.id) {
      const cur = state.prods.find((x) => x.id === state.pedit.id);
      if (cur && cur.stage === "dung") { const tmp = document.createElement("div"); tmp.innerHTML = pipePanel(cur); const nb = tmp.querySelector("#p-pipebox"); if (nb) box.replaceWith(nb); }
      else if (cur && cur.stage !== state.pedit.stage) openProd(cur.id);
    }
  }
  function livePipe() {
    const running = state.prods.some((p) => p.pipe?.status === "running" || p.pipe?.status === "queued");
    if (running && !pipeTimer) pipeTimer = setInterval(async () => { await loadProd(); if (state.view === "prod") renderProd(); }, 15000);
    if (!running && pipeTimer) { clearInterval(pipeTimer); pipeTimer = null; }
  }
  function askNotify() {
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) { /* trình duyệt không hỗ trợ */ }
  }
  function notify(title, body, prodId, isErr) {
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.innerHTML = `<b>${esc(title)}</b><span>${esc(body || "")}</span><div class="row" style="margin:6px 0 0;gap:6px"><button class="btn sm primary" data-prod="${prodId}">Mở</button><button class="btn sm" data-toastx="1">Đóng</button></div>`;
    let box = $("#toasts");
    if (!box) { box = Object.assign(document.createElement("div"), { id: "toasts" }); box.setAttribute("popover", "manual"); document.body.appendChild(box); }
    box.appendChild(t);
    try { if (box.showPopover) { if (box.matches(":popover-open")) box.hidePopover(); box.showPopover(); } } catch (e) { /* trình duyệt cũ: vẫn hiện như thường */ }
    setTimeout(() => { t.remove(); if (!box.children.length) try { box.hidePopover(); } catch (e) { /* bỏ qua */ } }, 60000);
    try { navigator.vibrate && navigator.vibrate(isErr ? [80, 60, 80] : 120); } catch (e) { /* bỏ qua */ }
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        const opt = { body: body || "", icon: "icons/icon-192.png", tag: "prod-" + prodId };
        if (navigator.serviceWorker?.ready) navigator.serviceWorker.ready.then((r) => r.showNotification(title, opt)).catch(() => new Notification(title, opt));
        else new Notification(title, opt);
      }
    } catch (e) { /* bỏ qua */ }
  }
  function pipePanel(p) {
    let h = "";
    const posts = p.package?.posts || [];
    if (p.output_url) h += `<a class="btn primary sm" style="display:inline-flex;margin:0 0 10px" href="${esc(p.output_url)}" target="_blank" rel="noopener">▶ Xem video hoàn thiện</a>`;
    if (posts.length) h += `<div class="paudit"><b>Lịch đăng Jarvis đã đặt trên Metricool</b><ul>${posts.map((x) => `<li>${esc(x.network)} · ${fmt(x.at)}${x.title ? ` · <span class="muted">${esc(x.title)}</span>` : ""}</li>`).join("")}</ul></div>`;
    if (p.package?.text) h += `<details class="paudit" open><summary><b>Gợi ý đăng TikTok / YouTube (anh tự đăng)</b></summary><div id="p-packshow" style="white-space:pre-wrap;margin-top:6px">${esc(p.package.text)}</div><button class="btn sm" type="button" data-pcopy="1" style="margin-top:8px">Copy toàn bộ</button></details>`;
    return h;
    if (p.edit_mode === "cloud" && p.stage === "dung") {
      const st = p.pipe?.status;
      h += `<div class="ppipe ${st === "error" ? "err" : ""}" id="p-pipebox"><b>${esc(pipeHint(p))}</b>${st === "running" ? pbar(p, true) : ""}
        ${st === "error" ? `<div class="muted" style="margin-top:4px">${esc(p.pipe.error || "")}</div>` : ""}
        ${p.pipe?.at ? `<div class="muted" style="font-size:12px;margin-top:4px">Cập nhật ${fmt(p.pipe.step_at || p.pipe.at)}${p.pipe.n ? ` · lần dựng ${p.pipe.n}` : ""}${p.pipe.run ? ` · <a href="${esc(p.pipe.run)}" target="_blank" rel="noopener">nhật ký</a>` : ""}</div>` : ""}
        ${p.stage === "dung" && st !== "running" ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn sm" type="button" data-prequeue="1">${st === "error" || st === "done" ? "Dựng lại" : "Đưa vào hàng chờ ngay"}</button><button class="btn sm" type="button" data-prequeue="transcribe">Chép lời trước để sửa</button></div>` : ""}</div>`;
    }
    if (p.transcript?.clips?.length) {
      const n = p.transcript.clips.reduce((a, c) => a + (c.sentences?.length || 0), 0);
      const ed = p.transcript.clips.reduce((a, c) => a + (c.sentences || []).filter((x) => x.drop || x.t !== x.t0).length, 0);
      h += `<button class="btn ${p.pipe?.status === "transcript" ? "primary" : ""} sm full" type="button" data-ptr="1" style="margin:0 0 10px">📝 Lời thoại · ${n} câu${ed ? ` · đã sửa ${ed}` : ""} · ${p.transcript.status === "approved" ? "đã duyệt" : "chờ anh sửa"}</button>`;
    }
    if (p.output_url) h += `<div class="row" style="margin:0 0 10px;gap:8px;flex-wrap:wrap"><a class="btn primary sm" style="display:inline-flex" href="${esc(p.output_url)}" target="_blank" rel="noopener">▶ Xem bản dựng</a>${p.audit?.sheet_url ? `<a class="btn sm" style="display:inline-flex" href="${esc(p.audit.sheet_url)}" target="_blank" rel="noopener">Lưới khung hình</a>` : ""}</div>`;
    const a = p.audit;
    if (a && (a.verdict || a.issues?.length)) {
      const c = a.checks || {};
      h += `<div class="paudit"><div class="ph"><b>Biên bản tự duyệt${a.n ? ` · bản ${a.n}` : ""}</b><span class="tag" style="color:${a.verdict === "pass" ? "var(--g)" : "#F5B544"}">${a.verdict === "pass" ? "Đạt" : "Cần xem"}${a.score != null ? ` ${a.score}/10` : ""}</span></div>
        ${a.summary ? `<p style="margin:4px 0 8px">${esc(a.summary)}</p>` : ""}
        ${(a.issues || []).length ? `<ul>${a.issues.map((i) => `<li>${i.t ? `<b>${esc(String(i.t))}s</b> · ` : ""}${esc(i.issue || "")}${i.fix ? ` <span class="muted">→ ${esc(i.fix)}</span>` : ""}</li>`).join("")}</ul>` : ""}
        ${(a.questions || []).length ? `<div style="margin-top:6px"><b>Câu hỏi cho anh:</b><ul>${a.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
        <div class="muted" style="font-size:12px;margin-top:6px">${[c.duration_s != null ? `${c.duration_s}s` : "", c.lufs != null ? `${c.lufs} LUFS` : "", c.speech_match != null ? `khớp lời ${Math.round(c.speech_match * 100)}%` : "", c.fillers_cut != null ? `cắt ${c.fillers_cut} từ đệm` : "", c.horizontal_share != null ? `footage ngang ${Math.round(c.horizontal_share * 100)}%` : "", c.music ? esc(c.music) : ""].filter(Boolean).join(" · ")}</div></div>`;
    }
    return h;
  }
  function openTranscript(id) {
    const p = state.prods.find((x) => x.id == id); const T = p?.transcript; if (!T) return;
    const KIND = { review: "review", doc: "dọc", ngang: "ngang", khac: "khác" };
    $("#detail-title").textContent = "Lời thoại · " + p.title;
    $("#detail-body").innerHTML = `<div style="white-space:normal">
      <p class="muted" style="margin:0 0 10px">Máy đã nghe từng clip và chép lời. Anh sửa chữ cho đúng lời mình nói (máy giữ mốc thời gian, chữ đã sửa dùng làm phụ đề). Câu nói hỏng, nói dở hoặc nói lặp thì tick <b>Bỏ</b>: máy sẽ không dùng câu đó.</p>
      ${T.clips.map((c, ci) => `<details class="trclip" ${c.sentences?.length ? "open" : ""}><summary><b>${esc(c.name)}</b> <span class="muted">· ${KIND[c.kind] || c.kind || ""} · ${Number(c.dur || 0).toFixed(0)}s · ${c.sentences?.length || 0} câu${c.sentences?.length ? "" : " (không có lời)"}</span></summary>
        ${(c.sentences || []).map((x) => `<div class="trrow ${x.drop ? "drop" : ""}"><span class="trt">${Number(x.s).toFixed(1)}s</span><textarea data-trk="${ci}.${x.k}" rows="2">${esc(x.t)}</textarea><label class="trd"><input type="checkbox" data-trd="${ci}.${x.k}" ${x.drop ? "checked" : ""}>Bỏ</label></div>`).join("")}</details>`).join("")}
    </div>`;
    $("#detail-actions").innerHTML = `<button class="btn" data-prod="${p.id}">Quay lại</button><button class="btn" data-trsuggest="1">Jarvis gợi ý câu bỏ</button><button class="btn" data-trsave="0">Lưu nháp</button><button class="btn primary" data-trsave="1">Duyệt lời & dựng</button>`;
    $("#detail-body").addEventListener("change", (e) => { const cb = e.target.closest("[data-trd]"); if (cb) cb.closest(".trrow").classList.toggle("drop", cb.checked); });
    if (!$("#detail").open) $("#detail").showModal();
  }
  const localDT = (iso) => { if (!iso) return ""; const d = new Date(new Date(iso).getTime() + 7 * 36e5); return d.toISOString().slice(0, 16); };

  function openProd(id, preset) {
    const p = id ? { ...state.prods.find((x) => x.id == id) } : { id: null, title: "", vtype: "roadtrip_short", stage: "kich_ban", edit_mode: "cloud", platforms: ["tiktok", "youtube_shorts", "facebook"], history: [], ...preset };
    state.pedit = p;
    const scripts = state.approvals.filter((a) => a.kind === "script" && (a.status === "approved" || a.id === p.script_id));
    const si = STG.findIndex(([k]) => k === p.stage);
    const pr = promptFor(p);
    $("#detail-title").textContent = p.id ? `${String(p.id).padStart(3, "0")} · ${p.title}` : "Video mới";
    $("#detail-body").innerHTML = `<div style="white-space:normal">
      <div class="pstep">${STG.map(([k, n], i) => `<span class="${i < si ? "done" : i === si ? "cur" : ""}">${n}</span>`).join("")}</div>
      <p class="muted" style="white-space:normal;margin:8px 0 12px">${esc(STEP_GUIDE[p.stage])}</p>
      ${p.id ? pipePanel(p) : ""}
      <div class="pform">
        <label class="full">Tên video<input id="p-title" value="${esc(p.title)}" placeholder="VD: Hà Giang mùa tam giác mạch"></label>
        <label>Loại video<select id="p-vtype">${Object.entries(VT).map(([k, v]) => `<option value="${k}" ${p.vtype === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>
<input type="hidden" id="p-mode" value="capcut">
        <label class="full">Kịch bản<select id="p-script"><option value="">— Chưa gắn —</option>${scripts.map((a) => `<option value="${a.id}" ${p.script_id === a.id ? "selected" : ""}>${esc(a.title.slice(0, 70))}</option>`).join("")}</select></label>${p.script_id ? `<button type="button" class="btn sm full" data-open="${p.script_id}">Xem / sửa kịch bản đã duyệt</button>` : ""}
        <label class="full">Footage trên Drive${p.location ? ` <span class="muted">· đang chọn: ${esc(p.location)}</span>` : ""}<span id="p-locbox">${locOptions(p)}</span></label>
        <label class="full">Video hoàn thiện (Jarvis tự điền khi anh tải lên Drive 06_VIDEO_HOAN_THIEN)<input id="p-out" value="${esc(p.output_url || "")}" placeholder="https://drive.google.com/…"></label>
        <label class="full">Nền tảng đăng<span class="pplat">${PLAT.map(([k, n]) => `<span class="ck"><input type="checkbox" value="${k}" ${p.platforms?.includes(k) ? "checked" : ""}> ${n}</span>`).join("")}</span></label>
        <label>Giờ đăng<input id="p-at" type="datetime-local" value="${localDT(p.scheduled_at)}"></label>
        <label class="ckl"><span class="ck"><input type="checkbox" id="p-pack" ${p.package?.done ? "checked" : ""}> Đã đóng gói (tiêu đề, mô tả, ảnh bìa)</span></label>
        ${["dong_goi", "len_lich", "da_dang"].includes(p.stage) ? `<label class="full">Gói đăng (dán tiêu đề, mô tả, hashtag từ Agent Đóng gói)<textarea id="p-packtxt" rows="5" placeholder="TikTok: …&#10;YouTube: tiêu đề …&#10;Facebook: …">${esc(p.package?.text || "")}</textarea></label>` : ""}
        ${p.stage === "len_lich" ? (() => { const sl = suggestSlot(p); return sl ? `<div class="full pslot">Giờ vàng gợi ý (${esc((PLAT.find((y) => y[0] === sl.net) || [sl.net, sl.net])[1])}): <b>${fmt(sl.at)}</b> <button class="btn sm" type="button" data-pslot="${sl.at}">Dùng giờ này</button></div>` : ""; })() : ""}
        <label class="full">Ghi chú / lỗi cần sửa<textarea id="p-note" rows="3">${esc(p.note || "")}</textarea></label>
      </div>
      ${pr && p.id ? `<div class="pprompt"><div class="ph"><b>${["len_lich", "da_dang"].includes(p.stage) ? "Lệnh cho Claude (điện thoại hoặc máy tính)" : "Lệnh cho Claude Code trên máy"}</b><button class="btn sm" type="button" data-copy="${esc(pr)}">Copy lệnh</button></div><pre>${esc(pr.slice(0, 600))}${pr.length > 600 ? "…" : ""}</pre></div>` : ""}
      ${p.history?.length ? `<details class="phist"><summary>Lịch sử (${p.history.length})</summary>${[...p.history].reverse().map((h) => `<div><span class="muted">${fmt(h.at)}</span> · ${esc(h.t)}</div>`).join("")}</details>` : ""}</div>`;
    const back = si > 0 && p.id ? `<button class="btn" data-pmove="-1">← ${STN[STG[si - 1][0]]}</button>` : "";
    const fwd = si < STG.length - 1 ? `<button class="btn primary" data-pmove="1">${p.id ? `Chuyển sang ${STN[STG[si + 1][0]]} →` : "Tạo video"}</button>` : "";
    $("#detail-actions").innerHTML = `${p.id ? `<button class="btn danger sm" data-pdel="1">Xoá</button>` : ""}<span style="flex:1"></span>${back}${p.id ? `<button class="btn" data-psave="1">Lưu</button>${fwd}` : `<button class="btn primary" data-psave="1">Tạo video</button>`}`;
    if (!$("#detail").open) $("#detail").showModal();

    const sc = $("#p-script"); sc.onchange = () => { const a = state.approvals.find((x) => x.id == sc.value); if (a && !$("#p-title").value.trim()) $("#p-title").value = a.title.replace(/^Kịch bản:\s*/i, ""); };
  }

  function readForm() {
    const p = state.pedit;
    const locSel = $("#p-loc");
    const loc = locSel && locSel.value ? state.driveLocs.locations.find((l) => l.id === locSel.value) : null;
    const at = $("#p-at").value;
    return {
      title: $("#p-title").value.trim(),
      vtype: $("#p-vtype").value,
      edit_mode: $("#p-mode").value,
      script_id: $("#p-script").value ? Number($("#p-script").value) : null,
      location: loc ? loc.name : p.location || null,
      drive_folder_id: loc ? loc.id : p.drive_folder_id || null,
      output_url: $("#p-out").value.trim() || null,
      platforms: $$(".pplat input:checked").map((i) => i.value),
      scheduled_at: at ? new Date(at + ":00+07:00").toISOString() : null,
      package: { ...(p.package || {}), done: $("#p-pack").checked, ...($("#p-packtxt") ? { text: $("#p-packtxt").value.trim() } : {}) },
      note: $("#p-note").value.trim() || null,
    };
  }
  async function saveProd(move) {
    const p = state.pedit; const f = readForm();
    if (!f.title) { $("#p-title").focus(); return; }
    const hist = [...(p.history || [])];
    let stage = p.stage;
    if (move) {
      const i = STG.findIndex(([k]) => k === stage) + move;
      if (i < 0 || i >= STG.length) return;
      stage = STG[i][0];
      hist.push({ at: new Date().toISOString(), t: `${move > 0 ? "Chuyển sang" : "Lùi về"} ${STN[stage]}${move < 0 && f.note ? `: ${f.note.slice(0, 120)}` : ""}` });
    }
    if (!p.id) hist.push({ at: new Date().toISOString(), t: "Tạo video" });
    const row = { ...f, stage, history: hist, updated_at: new Date().toISOString() };
    if (stage === "da_dang" && !row.scheduled_at) row.scheduled_at = new Date().toISOString();
    const { data, error } = p.id ? await sb.from("productions").update(row).eq("id", p.id).select().maybeSingle() : await sb.from("productions").insert(row).select().maybeSingle();
    if (error) return alertBox("Không lưu được", error.message);
    await loadProd(); state.pstage = stage; renderProd();
    if (data?.id) openProd(data.id); else $("#detail").close();
  }

  async function prodClick(el) {
    const ds = el.dataset;
    if (ds.view && $("#detail").open) $("#detail").close();
    if (ds.toastx) { el.closest(".toast")?.remove(); const bx = $("#toasts"); if (bx && !bx.children.length) try { bx.hidePopover(); } catch (e) { /* bỏ qua */ } return true; }
    if (ds.prod) { el.closest(".toast")?.remove(); if (state.view !== "prod") showView("prod"); openProd(ds.prod); return true; }
    if (el.id === "p-new") { openProd(null); return true; }
    if (ds.pfrom) { const a = state.approvals.find((x) => x.id == ds.pfrom); const tt = a.title.replace(/^Kịch bản:\s*/i, ""); const isRv = /review|đánh giá|trên tay|unbox/i.test(tt); openProd(null, { script_id: a.id, title: tt, ...(isRv ? { vtype: "review", edit_mode: "capcut" } : {}) }); return true; }
    if (ds.pst) { state.pstage = ds.pst; renderProd(); return true; }
    if (el.id === "p-loadloc" || el.id === "p-reloc") { el.disabled = true; el.textContent = "Đang đọc Drive…"; await loadDriveLocs(true); $("#p-locbox").innerHTML = locOptions(state.pedit); return true; }
    if (ds.prequeue) {
      askNotify();
      const p = state.pedit; const f = readForm();
      if (!f.location && !p.location) { alertBox("Chưa chọn footage", "Chọn địa điểm footage trên Drive trước."); return true; }
      const tr = ds.prequeue === "transcribe";
      await sb.from("productions").update({ ...f, edit_mode: "cloud", pipe: { ...(p.pipe || {}), status: "queued", mode: tr ? "transcribe" : null, at: new Date().toISOString(), error: null, step: null, pct: 0 }, history: [...(p.history || []), { at: new Date().toISOString(), t: tr ? "Đưa vào hàng chờ chép lời" : "Đưa vào hàng chờ máy dựng" }], updated_at: new Date().toISOString() }).eq("id", p.id);
      await loadProd(); renderProd(); openProd(p.id); return true;
    }
    if (ds.pcopy) { try { await navigator.clipboard.writeText($("#p-packshow").textContent); el.textContent = "Đã copy ✓"; } catch (e) { el.textContent = "Không copy được, giữ để chọn chữ"; } return true; }
    if (ds.ptr) { openTranscript(state.pedit.id); return true; }
    if (ds.trsuggest) {
      // gợi ý: câu nói dở (≤3 từ, "…") và các lần nói trước của cùng một ý trong cùng clip → tick Bỏ; anh xem lại rồi bỏ tick nếu sai
      const W = (t) => t.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w && !["ờ", "à", "ừ", "ừm", "thì", "và"].includes(w));
      const sim = (a, b) => { const A = new Set(a), B = new Set(b); let n = 0; A.forEach((x) => B.has(x) && n++); return (2 * n) / (A.size + B.size || 1); };
      let n = 0;
      const p = state.prods.find((x) => x.id == state.pedit.id);
      p.transcript.clips.forEach((c, ci) => {
        const rows = (c.sentences || []).map((x) => ({ k: x.k, w: W(document.querySelector(`[data-trk="${ci}.${x.k}"]`)?.value || x.t) }));
        const same = (r, o) => (r.w.length >= 3 && o.w.slice(0, 3).join(" ") === r.w.slice(0, 3).join(" ")) || sim(r.w, o.w) >= 0.6 || (r.w.length >= 2 && o.w.join(" ").includes(r.w.join(" ")));
        rows.forEach((r, i) => {
          // giữ lần nói sau cùng, trừ khi lần sau ngắn hơn hẳn (nói dở) thì giữ lần đầy đủ hơn
          const dup = rows.slice(i + 1).some((o) => same(r, o) && o.w.length >= r.w.length * 0.8)
            || rows.slice(0, i).some((o) => same(o, r) && o.w.length >= r.w.length * 1.3);
          const frag = r.w.length <= 2;
          const cb = document.querySelector(`[data-trd="${ci}.${r.k}"]`);
          if (cb && (dup || frag) && !cb.checked) { cb.checked = true; cb.closest(".trrow").classList.add("drop"); n++; }
        });
      });
      notify?.("Jarvis đã gợi ý", n ? `Đã tick Bỏ ${n} câu nói lặp/nói dở. Anh xem lại, bỏ tick câu nào muốn giữ rồi bấm Duyệt.` : "Không thấy câu nào lặp.");
      return true;
    }
    if (ds.trsave) {
      const p = state.prods.find((x) => x.id == state.pedit.id); const approve = ds.trsave === "1";
      const clips = p.transcript.clips.map((c, ci) => ({ ...c, sentences: (c.sentences || []).map((x) => {
        const ta = document.querySelector(`[data-trk="${ci}.${x.k}"]`), cb = document.querySelector(`[data-trd="${ci}.${x.k}"]`);
        return { ...x, t: ta ? ta.value.replace(/\s+/g, " ").trim() : x.t, drop: cb ? cb.checked : !!x.drop };
      }) }));
      el.disabled = true;
      const patch = { transcript: { ...p.transcript, clips, status: approve ? "approved" : "draft", edited_at: new Date().toISOString() }, updated_at: new Date().toISOString() };
      if (approve) {
        askNotify();
        Object.assign(patch, { stage: "dung", pipe: { ...(p.pipe || {}), status: "queued", mode: null, error: null, step: null, pct: 0, at: new Date().toISOString() },
          history: [...(p.history || []), { at: new Date().toISOString(), t: "Anh Thắng duyệt lời thoại, đưa vào hàng chờ dựng" }] });
      }
      const { error } = await sb.from("productions").update(patch).eq("id", p.id);
      if (error) { el.disabled = false; return alertBox("Chưa lưu được", error.message), true; }
      notify?.(approve ? "Đã duyệt lời thoại" : "Đã lưu nháp lời thoại", approve ? "Máy sẽ dựng theo lời anh đã sửa, câu gạch bỏ không dùng." : "");
      await loadProd(); renderProd(); openProd(p.id); return true;
    }
    if (ds.pslot) { $("#p-at").value = localDT(ds.pslot); return true; }
    if (ds.psave) { el.disabled = true; await saveProd(0); el.disabled = false; return true; }
    if (ds.pmove) { askNotify(); el.disabled = true; await saveProd(Number(ds.pmove)); el.disabled = false; return true; }
    if (ds.pdel) {
      if (!confirm(`Xoá video "${state.pedit.title}" khỏi bảng Sản xuất? Footage và bản dựng trên Drive không bị xoá.`)) return true;
      await sb.from("productions").delete().eq("id", state.pedit.id); $("#detail").close(); await loadProd(); renderProd(); return true;
    }
    return false;
  }

  // ======================= KẾT NỐI TÀI KHOẢN =======================
  state.live = {};
  async function loadLive() {
    const since = new Date(Date.now() - 31 * 864e5).toISOString();
    const { data } = await sb.from("platform_stats").select("platform,account,at,followers,views,videos,likes,extra").gte("at", since).order("at", { ascending: true }).limit(5000);
    const by = {};
    for (const r of data || []) (by[r.platform] ||= []).push(r);
    state.live = by;
  }
  const liveOf = (p) => {
    const rows = state.live[p] || []; if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const at = (ms) => rows.filter((r) => new Date(r.at) <= Date.now() - ms).pop();
    const d1 = at(864e5), d7 = at(7 * 864e5);
    const deep = [...rows].reverse().find((r) => r.extra);
    // gộp nhiều page Facebook: lấy bản mới nhất của từng tài khoản
    let followers = last.followers;
    if (p === "facebook") { const acc = {}; rows.forEach((r) => (acc[r.account] = r)); followers = Object.values(acc).reduce((a, r) => a + (r.followers || 0), 0); }
    if (p === "facebook") return { last, followers, d1: null, d7: null, deep: deep?.extra, hist: rows.map((r) => r.followers || 0) };
    return { last, followers, d1: d1 && last.followers != null ? last.followers - d1.followers : null, d7: d7 && last.followers != null ? last.followers - d7.followers : null, deep: deep?.extra, hist: rows.map((r) => r.followers || 0) };
  };
  const conns = () => getJSON("connections", {});
  const agoTxt = (iso) => { if (!iso) return "chưa"; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "vừa xong" : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : fmt(iso); };

  function connCards() {
    const c = conns();
    return `<div class="panel conn"><div class="ph"><h3>Kết nối tài khoản</h3><span class="muted" style="font-size:12px">Số liệu cập nhật mỗi 15 phút, kể cả khi tắt máy</span></div>
      <div class="conn-grid">${["youtube", "tiktok", "facebook"].map((p) => {
        const x = c[p] || {}, P = PL[p];
        const st = x.connected ? (x.error ? `<span class="cst bad">Lỗi: ${esc(x.error.slice(0, 90))}</span>` : `<span class="cst ok"><i></i>LIVE · ${agoTxt(x.last_sync)}</span>`) : `<span class="cst">Chưa kết nối</span>`;
        return `<div class="conn-c"><div class="conn-h"><span class="ico" style="background:${P.c}22;color:${P.c}">${P.ico}</span><b>${P.n}</b></div>
          ${st}${x.account ? `<span class="muted" style="font-size:12.5px">${esc(x.account)}</span>` : ""}
          <span class="muted" style="font-size:12px">${p === "youtube" ? "Sub, view, giờ xem, % giữ chân, nguồn traffic" : p === "tiktok" ? "Follow, tim, view từng video, chia sẻ" : "Follow, lượt xem, tương tác, bài đăng của 2 page"}</span>
          <div class="row" style="margin-top:6px">${x.connected
            ? `<button class="btn sm" data-csync="${p}">Cập nhật ngay</button><button class="btn sm" data-cstart="${p}">Kết nối lại</button><button class="btn sm danger" data-cdis="${p}">Ngắt</button>`
            : `<button class="btn sm primary" data-cstart="${p}">Kết nối ${P.n}</button>`}</div></div>`;
      }).join("")}</div></div>`;
  }

  const REDIRECT = (p) => `${cfg.url}/functions/v1/jarvis-runner/oauth/${p}`;
  function setupGuide(p, err) {
    const r = REDIRECT(p);
    const G = {
      youtube: `**Cần làm 1 lần (khoảng 5 phút) trên Google Cloud, cùng project đã tạo API key YouTube:**

1. Vào console.cloud.google.com › **APIs & Services › Library**, bật **YouTube Analytics API** (YouTube Data API đã bật sẵn).
2. **OAuth consent screen** (Google Auth Platform): User type **External**, tên app "Jarvis", email của anh. Ở mục **Audience** bấm **Publish app** để token không hết hạn sau 7 ngày.
3. **Credentials › Create credentials › OAuth client ID** › loại **Web application** › Authorized redirect URIs dán:
${r}
4. Copy **Client ID**, dán vào ô Client ID Google bên dưới rồi bấm Lưu.
5. Copy **Client secret**, tự dán vào Supabase › Edge Functions › **Secrets** với tên **GOOGLE_CLIENT_SECRET** (không dán vào chat hay vào app).
6. Quay lại đây bấm **Kết nối YouTube**. Google báo "ứng dụng chưa xác minh" thì bấm Nâng cao › Tiếp tục (app của chính anh).`,
      facebook: `**Cần làm 1 lần (khoảng 7 phút) trên Meta for Developers:**

1. Vào developers.facebook.com › **My Apps › Create app**. Tên "Jarvis", use case chọn **Manage everything on your Page** (quản lý Trang).
2. Trong app: **Facebook Login for Business › Settings** › Valid OAuth Redirect URIs dán:
${r}
3. Ở mục quyền (Permissions), đảm bảo có **pages_show_list, pages_read_engagement, read_insights**. App để chế độ Development là được vì anh là admin.
4. **App settings › Basic**: copy **App ID** dán vào ô App ID Meta bên dưới rồi bấm Lưu.
5. Copy **App secret**, tự dán vào Supabase › Edge Functions › **Secrets** tên **META_APP_SECRET**.
6. Bấm **Kết nối Facebook**, đăng nhập và **tích chọn cả 2 page** Chuyện của Thắng.`,
      tiktok: `**Cần làm 1 lần (khoảng 7 phút) trên TikTok for Developers:**

1. Vào developers.tiktok.com, đăng nhập bằng TikTok của kênh › **Manage apps › Connect an app**.
2. Chuyển app sang **Sandbox** (không cần TikTok duyệt). Trong Sandbox › **Target users** thêm tài khoản TikTok của kênh.
3. **Add products › Login Kit**, Redirect URI (Web) dán:
${r}
4. **Scopes**: thêm user.info.basic, user.info.profile, user.info.stats, video.list.
5. Copy **Client key** dán vào ô Client key TikTok bên dưới rồi bấm Lưu.
6. Copy **Client secret**, tự dán vào Supabase › Edge Functions › **Secrets** tên **TIKTOK_CLIENT_SECRET**.
7. Bấm **Kết nối TikTok** và đăng nhập đúng tài khoản kênh.`,
    };
    const ids = getJSON("oauth_clients", {});
    const key = { youtube: "google_client_id", facebook: "meta_app_id", tiktok: "tiktok_client_key" }[p];
    const lbl = { youtube: "Client ID Google", facebook: "App ID Meta", tiktok: "Client key TikTok" }[p];
    $("#detail-title").textContent = `Kết nối ${PL[p].n}`;
    $("#detail-body").innerHTML = (err ? `<p class="err" style="white-space:normal">${esc(err)}</p>` : "") + md(G[p]) +
      `<div class="row" style="white-space:normal"><button class="btn sm" data-copy="${esc(r)}">Copy Redirect URI</button></div>
       <label style="margin-top:12px">${lbl} (không phải secret)<input id="cid-in" value="${esc(ids[key] || "")}" autocomplete="off"></label>`;
    $("#detail-actions").innerHTML = `<button class="btn" id="cid-save" data-ckey="${key}" data-p="${p}">Lưu</button><button class="btn primary" data-cstart="${p}" data-force="1">Kết nối ${PL[p].n}</button>`;
    if (!$("#detail").open) $("#detail").showModal();
  }

  async function connClick(el) {
    const ds = el.dataset;
    if (ds.cstart) {
      el.disabled = true;
      try {
        const r = await callRunner({ oauth_start: ds.cstart });
        if (r.url) { if (/Electron/i.test(navigator.userAgent)) window.open(r.url, "_blank"); else location.href = r.url; }
        else setupGuide(ds.cstart, r.error);
      } catch (e) { setupGuide(ds.cstart, String(e.message || e)); }
      el.disabled = false; return true;
    }
    if (ds.csync) {
      el.disabled = true; el.textContent = "Đang cập nhật…";
      try { const r = await callRunner({ live_sync: ds.csync }); const bad = (r.out || []).find((x) => /lỗi|error/i.test(x)); if (bad) alertBox("Cập nhật chưa trọn", bad); } catch (e) { alertBox("Không cập nhật được", String(e.message || e)); }
      await refreshAll(); await loadLive(); await loadDash(); renderMine(); return true;
    }
    if (ds.cdis) { if (!confirm(`Ngắt kết nối ${PL[ds.cdis].n}? Jarvis sẽ ngừng lấy số liệu trực tiếp cho đến khi anh kết nối lại.`)) return true; await callRunner({ oauth_disconnect: ds.cdis }); await refreshAll(); renderMine(); return true; }
    if (el.id === "cid-save") {
      const ids = getJSON("oauth_clients", {}); ids[ds.ckey] = $("#cid-in").value.trim();
      await saveJSON("oauth_clients", ids); el.textContent = "Đã lưu"; return true;
    }
    if (ds.copy) { try { await navigator.clipboard.writeText(ds.copy); el.textContent = "Đã copy"; } catch { el.textContent = ds.copy; } return true; }
    return false;
  }

  // YouTube Analytics (khi đã kết nối)
  function ytDeepHtml(dp) {
    if (!dp?.totals) return "";
    const t = dp.totals, net = (t.subscribersGained || 0) - (t.subscribersLost || 0);
    const TR = { YT_SEARCH: "Tìm kiếm YouTube", SUGGESTED: "Video đề xuất", BROWSE_FEATURES: "Trang chủ / Browse", SHORTS: "Shorts feed", EXT_URL: "Link bên ngoài", PLAYLIST: "Playlist", CHANNEL: "Trang kênh", NOTIFICATION: "Thông báo", SUBSCRIBER: "Người đăng ký", NO_LINK_OTHER: "Trực tiếp / khác", RELATED_VIDEO: "Video liên quan", END_SCREEN: "Màn hình kết thúc", YT_OTHER_PAGE: "Trang YouTube khác", HASHTAGS: "Hashtag" };
    const trTot = (dp.traffic || []).reduce((a, r) => a + r[1], 0) || 1;
    return `<h3 style="margin-top:16px">YouTube Analytics · 28 ngày</h3>
      <div class="sgrid">
        <div><span>Lượt xem</span><b>${short(t.views)}</b></div>
        <div><span>Giờ xem</span><b>${short((t.estimatedMinutesWatched || 0) / 60)}</b></div>
        <div><span>% xem trung bình</span><b>${dec(t.averageViewPercentage || 0, 1)}%</b></div>
        <div><span>Thời lượng xem TB</span><b>${durTxt(Math.round(t.averageViewDuration || 0))}</b></div>
        <div><span>Sub ròng</span><b class="${net >= 0 ? "up" : "down"}">${net >= 0 ? "+" : ""}${nf(net)}</b></div>
        <div><span>Like · bình luận</span><b>${short(t.likes)} · ${short(t.comments)}</b></div>
      </div>
      ${dp.top?.length ? `<h3 style="margin-top:14px">Video theo % giữ chân</h3><div class="ret">${dp.top.slice(0, 6).map((v) => `<div class="r"><span title="${esc(v.title)}">${esc((v.title || "").slice(0, 46))}</span><span class="track"><i style="width:${Math.min(100, v.avgPct || 0)}%;background:${(v.avgPct || 0) >= 40 ? "var(--g)" : (v.avgPct || 0) >= 25 ? "var(--amber)" : "var(--err)"}"></i></span><b>${dec(v.avgPct || 0, 0)}%</b><small>${short(v.views)} view</small></div>`).join("")}</div>` : ""}
      ${dp.traffic?.length ? `<h3 style="margin-top:14px">Nguồn lượt xem</h3><div class="hb">${dp.traffic.slice(0, 5).map((r) => `<div class="r"><span>${TR[r[0]] || r[0]}</span><span class="track"><i style="width:${(r[1] / trTot) * 100}%"></i></span><b>${Math.round((r[1] / trTot) * 100)}%</b></div>`).join("")}</div>` : ""}`;
  }
  function ttDeepHtml(dp) {
    if (!dp?.videos?.length) return "";
    const vs = dp.videos.slice(0, 8);
    return `<h3 style="margin-top:16px">Video TikTok gần nhất (từ tài khoản)</h3><div class="list">${vs.map((v) => `<a class="card ttv" href="${esc(v.url || "#")}" target="_blank" rel="noopener"><div class="body"><span class="title" style="font-size:13.5px">${esc((v.title || "(không tiêu đề)").slice(0, 80))}</span>
      <span class="meta"><b style="color:var(--text)">${short(v.views)}</b> view · ${short(v.likes)} tim · ${short(v.comments)} bình luận · ${short(v.shares)} chia sẻ · ${durTxt(v.dur)}</span></div></a>`).join("")}</div>`;
  }

  function handleConnHash() {
    const m = location.hash.match(/^#ket-noi-(youtube|tiktok|facebook)-(ok|loi)(?:~(.*))?$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname);
    showView("mine");
    let msg = ""; try { msg = decodeURIComponent(m[3] || ""); } catch (e) { msg = ""; }
    if (m[2] === "ok") alertBox(`Đã kết nối ${PL[m[1]].n}`, "Jarvis đã lấy số liệu lần đầu và sẽ cập nhật mỗi 15 phút, kể cả khi anh tắt máy.");
    else alertBox(`Chưa kết nối được ${PL[m[1]].n}`, msg || "Anh bấm Kết nối lại thử nhé.");
  }

  // ---- chỉnh số phút ----
  function openMinutes() {
    const m = minutesMap();
    $("#detail-title").textContent = "Số phút anh tự làm mỗi loại việc";
    $("#detail-body").innerHTML = `<p class="muted" style="white-space:normal">Jarvis dùng các con số này để tính "Thời gian trả lại". Điền thời gian anh tự làm một lần việc đó nếu không có Jarvis.</p>
      <div class="mins">${Object.keys(DEF_MIN).map((k) => `<span>${KIND_NAME[k]}</span><input type="number" min="0" step="5" data-min="${k}" value="${m[k]}">`).join("")}</div>`;
    $("#detail-actions").innerHTML = `<button class="btn primary" id="min-save">Lưu</button>`;
    $("#detail").showModal();
  }

  // ======================= NHIỆM VỤ =======================
  const FILTERS = [
    ["all", "Tất cả việc"], ["today", "Hôm nay"], ["upcoming", "Sắp tới"], ["overdue", "Quá hạn"],
    ["repeat", "Lặp lại"], ["error", "Chạy lỗi"], ["done", "Đã xong"], ["off", "Đang tắt"],
  ];
  function filt(key, t) {
    const now = Date.now(), nx = t.next_run_at ? new Date(t.next_run_at).getTime() : null;
    switch (key) {
      case "today": return t.enabled && isToday(t.next_run_at);
      case "upcoming": return t.enabled && nx && nx > now && !isToday(t.next_run_at);
      case "overdue": return t.enabled && nx && nx < now - 15 * 60e3;
      case "repeat": return !!t.schedule?.type;
      case "error": return t.last_status === "error";
      case "done": return t.last_status === "ok";
      case "off": return !t.enabled;
      default: return true;
    }
  }
  function renderTasks() {
    const pending = state.approvals.filter((x) => x.status === "pending").length;
    const banner = $("#inbox-banner");
    banner.classList.toggle("hidden", !pending);
    banner.innerHTML = `<b>${pending} nội dung đang chờ anh duyệt</b><button class="btn sm" data-go="inbox">Mở hộp duyệt</button>`;

    $("#task-chips").innerHTML = FILTERS.map(([k, l]) => {
      const n = state.tasks.filter((t) => filt(k, t)).length;
      return `<button class="chip ${state.filter === k && !state.assist ? "active" : ""} ${k === "error" && n ? "bad" : ""}" data-filter="${k}">${l} <b>${n}</b></button>`;
    }).join("") + `<button class="chip" data-view="log">Nhật ký</button>`;
    const asst = {};
    state.tasks.forEach((t) => (asst[t.assistant] = (asst[t.assistant] || 0) + 1));
    $("#assist-chips").innerHTML = `<span class="muted" style="font-size:12px;align-self:center;letter-spacing:1px;white-space:nowrap">TRỢ LÝ</span>` +
      Object.entries(asst).map(([a, n]) => `<button class="chip ${state.assist === a ? "active" : ""}" data-assist="${esc(a)}">${esc(a)} <b>${n}</b></button>`).join("");

    let list = state.tasks.filter((t) => filt(state.filter, t));
    if (state.assist) list = state.tasks.filter((t) => t.assistant === state.assist);
    $("#tasks-title").textContent = state.assist ? "Trợ lý " + state.assist : (FILTERS.find((f) => f[0] === state.filter) || [])[1] || "Nhiệm vụ";

    $("#task-list").innerHTML = list.length ? list.map((t) => `
      <article class="card ${t.last_status === "error" ? "error" : ""}">
        <button class="play" data-run="${t.id}" aria-label="Chạy ngay" title="Chạy ngay"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></button>
        <div class="body">
          <span class="title">${esc(t.title)}</span>
          <span class="sched">${esc(t.schedule_label)}</span>
          ${t.last_status === "error"
            ? `<span class="meta err"><span class="tag">${esc(t.assistant)}</span>Lỗi: ${esc((t.last_error || "").slice(0, 160))}</span>`
            : `<span class="meta"><span class="tag">${esc(t.assistant)}</span>${t.last_status === "running" ? '<b class="status-running">Đang chạy…</b>' : "Lần tới: " + (t.enabled ? fmt(t.next_run_at) : "đang tắt")}${t.last_run_at ? " · Lần trước: " + fmt(t.last_run_at) : ""}</span>`}
        </div>
        <button class="switch" data-toggle="${t.id}" aria-pressed="${t.enabled}" aria-label="${t.enabled ? "Đang bật" : "Đang tắt"}"><span class="knob"></span></button>
      </article>`).join("") : `<div class="empty">Không có nhiệm vụ nào ở mục này.</div>`;
  }

  function renderAutopilot() {
    const on = state.settings.autopilot !== "off";
    ["#autopilot", "#autopilot-m"].forEach((s) => $(s)?.setAttribute("aria-pressed", on));
  }
  async function toggleAutopilot() {
    const on = state.settings.autopilot !== "off";
    if (on) {
      const ids = state.tasks.filter((t) => t.enabled).map((t) => t.id);
      await sb.from("settings").upsert([{ key: "autopilot", value: "off" }, { key: "autopilot_saved", value: JSON.stringify(ids) }]);
      if (ids.length) await sb.from("tasks").update({ enabled: false }).in("id", ids);
    } else {
      let ids = []; try { ids = JSON.parse(state.settings.autopilot_saved || "[]"); } catch {}
      if (!ids.length) ids = state.tasks.map((t) => t.id);
      await sb.from("tasks").update({ enabled: true, next_run_at: null }).in("id", ids);
      await sb.from("settings").upsert([{ key: "autopilot", value: "on" }]);
    }
    await refreshAll(); if (state.view === "dash") renderDash();
  }

  // ======================= SỰ KIỆN =======================
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a[data-go]");
    if (a) { e.preventDefault(); if (a.dataset.flt) state.filter = a.dataset.flt; return showView(a.dataset.go); }
    const el = e.target.closest("button");
    if (!el) return;

    if (await connClick(el)) return;
    if (await prodClick(el)) return;
    if (await extraClick(el)) return;
    if (el.dataset.view) return showView(el.dataset.view);
    if (el.dataset.go) return showView(el.dataset.go);
    if (el.dataset.range) { state.range = +el.dataset.range; $$("[data-range]").forEach((b) => b.classList.toggle("on", b === el)); return renderArea(); }
    if (el.dataset.mk) { state.mkPlat = el.dataset.mk; $$("[data-mk]").forEach((b) => b.classList.toggle("on", b === el)); return renderMarkets(); }
    if (el.dataset.len) { state.lenPlat = el.dataset.len; $$("[data-len]").forEach((b) => b.classList.toggle("on", b === el)); return renderLen(); }
    if (el.id === "autopilot" || el.id === "autopilot-m") { el.disabled = true; await toggleAutopilot(); el.disabled = false; return; }
    if (el.id === "min-save") {
      const m = {}; $$("[data-min]").forEach((i) => (m[i.dataset.min] = Math.max(0, Number(i.value) || 0)));
      await sb.from("settings").upsert([{ key: "minutes", value: JSON.stringify(m) }]);
      state.settings.minutes = JSON.stringify(m); $("#detail").close(); return renderDash();
    }
    if (el.id === "edit-min") return openMinutes();
    if (el.dataset.filter) { state.filter = el.dataset.filter; state.assist = null; return renderTasks(); }
    if (el.dataset.assist) { state.assist = state.assist === el.dataset.assist ? null : el.dataset.assist; return renderTasks(); }
    if (el.dataset.inbox) { state.inbox = el.dataset.inbox; $$("[data-inbox]").forEach((b) => b.classList.toggle("active", b === el)); return renderInbox(); }
    if (el.dataset.logf) { state.logf = el.dataset.logf; $$("[data-logf]").forEach((b) => b.classList.toggle("active", b === el)); return renderLog(); }
    if (el.dataset.toggle) {
      const t = state.tasks.find((x) => x.id == el.dataset.toggle);
      await sb.from("tasks").update({ enabled: !t.enabled, next_run_at: null }).eq("id", t.id);
      return refreshAll();
    }
    if (el.dataset.run) {
      el.disabled = true;
      const t = state.tasks.find((x) => x.id == el.dataset.run);
      t.last_status = "running"; renderTasks();
      try { await callRunner({ task_id: t.id }); } catch (err) { alertBox("Không chạy được", String(err.message || err)); }
      if (t.kind === "weekly_goals") { renderGoals(); const iv = setInterval(async () => { await refreshAll(); if (state.view === "goals") renderGoals(); const tt = state.tasks.find((x) => x.id === t.id); if (tt?.last_status !== "running") { clearInterval(iv); renderGoalMini?.(); } }, 10000); }
      return refreshAll();
    }
    if (el.dataset.open) {
      const ap = state.approvals.find((x) => x.id == el.dataset.open);
      return openDetail(ap.title, ap.body, ap.status === "pending" || ap.status === "error" || (ap.kind === "script" && ap.status === "approved") ? ap : null);
    }
    if (el.dataset.openrun) {
      const r = state.runs.find((x) => x.id == el.dataset.openrun);
      return openDetail(r.tasks?.title || "Lần chạy", r.status === "error" ? "Lỗi: " + r.error : stripPreamble(r.output) || "(trống)");
    }
    if (el.dataset.sedit) {
      const ap = state.approvals.find((x) => x.id == el.dataset.sedit);
      $("#detail-body").innerHTML = `<textarea id="sedit-text" style="width:100%;min-height:55vh;font:inherit;padding:10px;border-radius:10px;background:var(--bg2,#111);color:inherit;border:1px solid var(--line,#333)">${esc(ap.body || "")}</textarea>`;
      $("#detail-actions").innerHTML = `<button class="btn primary" data-ssave="${ap.id}">Lưu kịch bản</button><button class="btn" data-open="${ap.id}">Huỷ</button>`;
      return $("#sedit-text").focus();
    }
    if (el.dataset.ssave) {
      const body = $("#sedit-text").value.trim(); if (!body) return;
      const { error } = await sb.from("approvals").update({ body, note: "Anh Thắng tự sửa sau khi duyệt · " + new Date().toLocaleString("vi-VN") }).eq("id", el.dataset.ssave);
      if (error) return alertBox("Chưa lưu được", error.message);
      $("#detail").close(); notify?.("Đã lưu kịch bản", "Video gắn kịch bản này sẽ dùng bản mới.");
      return refreshAll();
    }
    if (el.dataset.sjarvis) {
      const note = $("#decide-note")?.value?.trim();
      if (!note) { $("#decide-note").focus(); $("#decide-note").placeholder = "Ghi ý cần thêm/sửa trước khi bấm"; return; }
      await sb.from("approvals").update({ status: "revise", note, processed_at: null, decided_at: new Date().toISOString() }).eq("id", el.dataset.sjarvis);
      $("#detail").close(); kickScripts();
      notify?.("Jarvis đang sửa kịch bản", "Bản mới sẽ vào Hộp duyệt. Duyệt xong, video tự chuyển sang bản mới.");
      return refreshAll();
    }
    if (el.dataset.fbok) {
      const body = $("#fb-cap")?.value?.trim(); if (!body) return;
      el.disabled = true;
      await sb.from("approvals").update({ body, status: "approved", decided_at: new Date().toISOString() }).eq("id", el.dataset.fbok);
      $("#detail").close(); notify?.("Đã duyệt bài Facebook", "Jarvis sẽ đặt lịch giờ vàng trong vòng 1 tiếng (video được ưu tiên giờ đẹp).");
      return refreshAll();
    }
    if (el.dataset.decide) {
      const [id, status] = el.dataset.decide.split(":");
      const note = $("#decide-note")?.value?.trim() || null;
      if (status === "revise" && !note) { $("#decide-note").focus(); $("#decide-note").placeholder = "Ghi rõ chỗ cần sửa trước khi bấm Yêu cầu sửa"; return; }
      await sb.from("approvals").update({ status, note, decided_at: new Date().toISOString() }).eq("id", id);
      $("#detail").close();
      const ap = state.approvals.find((x) => x.id == id);
      if (ap?.kind === "script" && status === "approved" && ap.revise_of) {
        // bản sửa được duyệt: chuyển các video đang gắn bản cũ sang bản mới
        const chain = []; let cur = ap;
        while (cur?.revise_of && !chain.includes(cur.revise_of)) { chain.push(cur.revise_of); cur = state.approvals.find((x) => x.id == cur.revise_of); }
        if (chain.length) await sb.from("productions").update({ script_id: ap.id }).in("script_id", chain);
      }
      if ((ap?.kind === "ideas" && status === "approved") || status === "revise") kickScripts();
      return refreshAll();
    }
    if (el.dataset.plat) { state.plat = el.dataset.plat; $$("[data-plat]").forEach((b) => b.classList.toggle("active", b === el)); return renderComp(); }
    if (el.dataset.cst) {
      const [id, status] = el.dataset.cst.split(":");
      await sb.from("competitors").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
      return loadComp();
    }
    if (el.id === "comp-add") {
      const v = $("#comp-input").value.trim(); if (!v) return;
      const plat = state.plat; let row;
      if (plat === "youtube") {
        const m = v.match(/youtube\.com\/channel\/(UC[\w-]+)/); const h = v.match(/@([\w.\-]+)/);
        const hd = h ? h[1] : v.replace(/^@/, "");
        row = m ? { channel_id: m[1], url: v } : { handle: "@" + hd, url: "https://www.youtube.com/@" + hd };
      } else {
        const h = v.match(/@([\w.\-]+)/); const u = h ? h[1] : v.replace(/^@/, "");
        row = { channel_id: u, handle: "@" + u, url: "https://www.tiktok.com/@" + u, name: "@" + u };
      }
      const { error } = await sb.from("competitors").insert({ platform: plat, source: "manual", status: "pinned", ...row });
      if (error) return alertBox("Không thêm được", error.message.includes("duplicate") ? "Kênh này đã có trong danh sách." : error.message);
      $("#comp-input").value = ""; return loadComp();
    }
    if (el.id === "scan-now") {
      const t = state.tasks.find((x) => x.kind === "scan_data");
      if (!t) return alertBox("Chưa có tác vụ quét", "Cần chạy file SQL v0.3 trên Supabase.");
      el.disabled = true; el.textContent = "Đang quét…";
      try { await callRunner({ task_id: t.id }); } catch (er) { alertBox("Không quét được", String(er.message || er)); }
      setTimeout(() => { el.disabled = false; el.textContent = "Quét số liệu ngay"; loadComp(); refreshAll(); }, 45000);
      return;
    }
    if (el.dataset.retry) {
      await sb.from("approvals").update({ status: "queued", attempts: 0, note: null }).eq("id", el.dataset.retry);
      $("#detail").close(); kickScripts(); return refreshAll();
    }
    if (el.id === "new-idea") {
      $("#detail-title").textContent = "Ý tưởng của tôi";
      $("#detail-body").innerHTML = '<p class="muted" style="white-space:normal">Mô tả ý tưởng: đi đâu / review món gì, đã có footage gì, con số thật (km, tiền, thời gian), muốn đăng nền tảng nào. Jarvis sẽ viết kịch bản và gửi vào Hộp duyệt.</p><textarea id="idea-text" rows="9"></textarea>';
      $("#detail-actions").innerHTML = '<button class="btn primary" id="idea-send">Gửi cho Jarvis viết kịch bản</button>';
      return $("#detail").showModal();
    }
    if (el.id === "idea-send") {
      const body = $("#idea-text").value.trim(); if (!body) return;
      await sb.from("approvals").insert({ kind: "ideas", status: "approved", title: "Ý tưởng của anh Thắng", body, note: "Viết kịch bản cho đúng ý tưởng này", decided_at: new Date().toISOString() });
      $("#detail").close(); kickScripts(); return showView("inbox");
    }
    if (el.id === "install") return installApp();
  });

  // tooltip chung cho phần tử có data-tip
  const tip = $("#tip");
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tip]"); if (!t) return;
    tip.textContent = t.dataset.tip; tip.classList.remove("hidden");
  });
  document.addEventListener("pointermove", (e) => {
    if (tip.classList.contains("hidden")) return;
    if (!e.target.closest("[data-tip]")) return tip.classList.add("hidden");
    tip.style.left = Math.min(innerWidth - 270, e.clientX + 12) + "px"; tip.style.top = e.clientY - 38 + "px";
  });
  document.addEventListener("pointerdown", (e) => { const t = e.target.closest("[data-tip]"); if (t) { tip.textContent = t.dataset.tip; tip.classList.remove("hidden"); tip.style.left = Math.min(innerWidth - 270, e.clientX + 12) + "px"; tip.style.top = e.clientY - 44 + "px"; setTimeout(() => tip.classList.add("hidden"), 2200); } });

  let rT; addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => state.view === "dash" && renderArea(), 150); });

  // ======================= HỘP DUYỆT =======================
  function renderInbox() {
    const active = ["pending", "queued", "writing", "error"];
    const list = state.approvals.filter((a) => (state.inbox === "pending" ? active.includes(a.status) : !active.includes(a.status)));
    const KIND = { ideas: "Ý tưởng", script: "Kịch bản", fb_post: "Bài ảnh Facebook" };
    const ST = { approved: ["Đã duyệt", "status-ok"], rejected: ["Từ chối", "status-error"], revise: ["Đang yêu cầu sửa", "muted"], revised: ["Đã có bản sửa", "muted"], error: ["Lỗi – bấm Xem để thử lại", "status-error"] };
    $("#inbox-list").innerHTML = list.length ? list.map((a) => `
      <article class="card">
        <div class="body">
          <span class="title">${esc(a.title)}</span>
          <span class="meta"><span class="tag">${KIND[a.kind] || esc(a.kind)}</span>${a.version > 1 ? `<span class="tag">Bản ${a.version}</span>` : ""}${fmt(a.created_at)}
          ${ST[a.status] ? ` · <b class="${ST[a.status][1]}">${ST[a.status][0]}</b>` : ""}${a.kind === "fb_post" && a.status === "approved" ? ` · ${a.meta?.scheduled_at ? `đăng ${fmt(a.meta.scheduled_at)}` : a.meta?.error ? `<b class="status-error">lỗi đặt lịch</b>` : "chờ Jarvis đặt lịch"}` : ""}</span>
        </div>
        ${a.status === "queued" || a.status === "writing" ? `<span class="status-running" style="font-size:13px">Jarvis đang viết…</span>`
          : `<button class="btn sm ${a.status === "pending" ? "primary" : ""}" data-open="${a.id}">${a.status === "pending" ? "Xem & duyệt" : a.kind === "script" && a.status === "approved" ? "Xem & sửa" : "Xem"}</button>`}
      </article>`).join("") : `<div class="empty">${state.inbox === "pending" ? "Không có gì chờ duyệt." : "Chưa có mục nào."}</div>`;
  }

  // ======================= NHẬT KÝ =======================
  function renderLog() {
    let runs = state.runs;
    if (state.logf === "error") runs = runs.filter((r) => r.status === "error");
    if (state.logf === "report") runs = runs.filter((r) => r.status === "ok" && ["research_daily", "weekly_ideas", "trend_alert"].includes(r.tasks?.kind) && !/KHONG_CO_GI_MOI/.test(r.output || ""));
    $("#log-list").innerHTML = runs.length ? runs.map((r) => {
      const pv = r.status === "ok" ? stripPreamble(r.output).replace(/[#*]/g, "").trim().slice(0, 140) : "";
      return `<article class="card ${r.status === "error" ? "error" : ""}">
        <div class="body">
          <span class="title">${esc(r.tasks?.title?.split(":")[0] || "Tác vụ")}</span>
          <span class="meta"><b class="status-${r.status}">${r.status === "ok" ? "Xong" : r.status === "error" ? "Lỗi" : "Đang chạy"}</b> · ${fmt(r.started_at)}</span>
          ${pv ? `<span class="meta" style="color:var(--text2)">${esc(pv)}…</span>` : ""}
        </div>
        ${r.status !== "running" ? `<button class="btn sm" data-openrun="${r.id}">Xem</button>` : ""}
      </article>`;
    }).join("") : `<div class="empty">Chưa có lần chạy nào ở mục này.</div>`;
  }

  // ======================= ĐỐI THỦ =======================
  async function loadComp() {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const [c, v] = await Promise.all([
      sb.from("competitors").select("*").order("hits", { ascending: false }).limit(300),
      sb.from("videos").select("*").gte("published_at", since).order("views", { ascending: false }).limit(400),
    ]);
    state.comps = c.data ?? []; state.vids = v.data ?? [];
    renderComp();
  }
  function renderComp() {
    const p = state.plat, order = { pinned: 0, active: 1, ignored: 2 };
    const comps = state.comps.filter((x) => x.platform === p && x.status !== "mine").sort((a, b) => order[a.status] - order[b.status] || (b.followers ?? 0) - (a.followers ?? 0));
    const ign = new Set(state.comps.filter((x) => x.status === "ignored" || x.status === "mine").map((x) => x.platform + ":" + x.channel_id));
    $("#comp-list").innerHTML = comps.length ? comps.map((x) => `
      <article class="card" style="${x.status === "ignored" ? "opacity:.5" : ""}">
        <div class="body">
          <span class="title">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name || x.handle || x.channel_id)}</a>` : esc(x.name || x.handle || x.channel_id)}</span>
          <span class="meta"><span class="tag">${x.status === "pinned" ? "Đã ghim" : x.status === "ignored" ? "Bỏ qua" : "Tự tìm"}</span>
            <span><b class="num">${nf(x.followers)}</b> follow</span> · <span>xuất hiện <b class="num">${x.hits}</b> lần trong top ngách</span>
            ${x.channel_id ? "" : " · <i>chờ lần quét tới để nhận diện kênh</i>"}</span>
        </div>
        ${x.status !== "pinned" ? `<button class="btn sm" data-cst="${x.id}:pinned">Ghim</button>` : `<button class="btn sm" data-cst="${x.id}:active">Bỏ ghim</button>`}
        ${x.status !== "ignored" ? `<button class="btn sm danger" data-cst="${x.id}:ignored">Bỏ qua</button>` : `<button class="btn sm" data-cst="${x.id}:active">Theo dõi lại</button>`}
      </article>`).join("") : `<div class="empty">Chưa có kênh ${p === "youtube" ? "YouTube" : "TikTok"}. Bấm "Quét số liệu ngay" hoặc thêm tay.</div>`;
    const days = p === "youtube" ? 30 : 90;
    const since = Date.now() - days * 864e5;
    const vids = state.vids.filter((v) => v.platform === p && new Date(v.published_at) >= since && !ign.has(v.platform + ":" + v.channel_id)).slice(0, 20);
    $("#vid-list").innerHTML = vids.length ? vids.map((v) => {
      const d = Math.max(1, (Date.now() - new Date(v.published_at)) / 864e5);
      const x = v.followers ? v.views / v.followers : 0;
      return `<article class="card"><div class="body">
        <span class="title"><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc((v.title || "(không tiêu đề)").slice(0, 110))}</a></span>
        <span class="meta"><span>${esc(v.channel_name)}</span> · <b class="num" style="color:var(--text)">${nf(v.views)}</b> view · <span class="num">${nf(Math.round(v.views / d))}</span> view/ngày ·
          ${v.duration_s ?? "?"}s · ${nf(v.likes)} like · ${nf(v.comments)} bình luận ${x >= 3 ? `<span class="pill-s">Vượt mặt x${x.toFixed(1)}</span>` : ""}</span>
      </div></article>`;
    }).join("") : `<div class="empty">Chưa có số liệu ${days} ngày.</div>`;
  }

  // ======================= BỘ NÃO =======================
  async function loadBrain() {
    const { data } = await sb.from("settings").select("key,value").in("key", ["brain", "script_rules", "keywords"]);
    const get = (k) => (data || []).find((r) => r.key === k)?.value?.trim() ?? "";
    $("#brain-text").value = get("brain"); $("#rules-text").value = get("script_rules"); $("#kw-text").value = get("keywords");
  }
  $("#brain-save").addEventListener("click", async () => {
    const { error } = await sb.from("settings").upsert([
      { key: "brain", value: $("#brain-text").value }, { key: "script_rules", value: $("#rules-text").value }, { key: "keywords", value: $("#kw-text").value },
    ]);
    $("#brain-msg").textContent = error ? "Lỗi: " + error.message : "Đã lưu.";
    setTimeout(() => ($("#brain-msg").textContent = ""), 3000);
  });

  // ======================= CÀI ĐẶT =======================
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
  $("#reset").addEventListener("click", async () => { await sb.auth.signOut(); localStorage.removeItem(CFG_KEY); location.reload(); });

  // ======================= ĐIỀU HƯỚNG =======================
  function showView(v) {
    state.view = v;
    $$(".view").forEach((s) => s.classList.add("hidden"));
    $(`#view-${v}`).classList.remove("hidden");
    $$(".nav, .bottom button").forEach((b) => b.classList.toggle("active", b.dataset.view === v || (v === "more" && false) || (["log", "brain", "settings"].includes(v) && b.dataset.view === "more" && b.closest(".bottom"))));
    if (v === "brain") loadBrain();
    if (v === "comp") loadComp();
    if (v === "tasks") renderTasks();
    if (v === "prod") { renderProd(); loadProd().then(renderProd); }
    if (v === "mine") renderMine();
    if (v === "goals") renderGoals();
    if (v === "hot") renderHot();
    if (["mine", "goals", "hot"].includes(v) && sb && !state.d) loadDash().then(() => showView(v));
    if (v === "dash") { if (state.d) renderDash(); if (sb) loadDash(); }
    window.scrollTo(0, 0);
  }
  function openDetail(title, body, approval) {
    $("#detail-title").textContent = title;
    $("#detail-body").innerHTML = md(body);
    if (approval?.status === "error") {
      $("#detail-body").innerHTML = md("Jarvis chưa viết xong kịch bản này.\n\nLý do: " + (approval.note || "không rõ") + "\n\nBấm Thử lại để Jarvis viết lại.");
      $("#detail-actions").innerHTML = `<button class="btn primary" data-retry="${approval.id}">Thử lại</button>`;
      return $("#detail").showModal();
    }
    if (approval?.kind === "fb_post") {
      const ims = approval.meta?.images || [];
      $("#detail-body").innerHTML = `<div style="white-space:normal">
        <div class="fbimgs">${ims.map((im) => im.thumb ? `<img src="data:image/jpeg;base64,${im.thumb}" alt="${esc(im.name || "")}">` : `<span class="muted">${esc(im.name || im.id)}</span>`).join("")}</div>
        ${approval.meta?.why ? `<p class="muted" style="margin:8px 0">${esc(approval.meta.why)}</p>` : ""}
        ${approval.status === "pending" ? `<label class="muted" style="display:block;margin:8px 0 4px">Nội dung bài (sửa trực tiếp nếu cần)</label><textarea id="fb-cap" rows="8" style="width:100%;font:inherit;padding:10px;border-radius:10px;border:1px solid var(--line,#333);background:transparent;color:inherit">${esc(approval.body)}</textarea>`
          : `<div style="white-space:pre-wrap;margin-top:8px">${esc(approval.body)}</div>${approval.meta?.scheduled_at ? `<p><b>Đăng lúc ${fmt(approval.meta.scheduled_at)}</b> (Facebook, qua Metricool)</p>` : approval.meta?.error ? `<p class="status-error">Lỗi đặt lịch: ${esc(approval.meta.error)}</p>` : approval.status === "approved" ? `<p class="muted">Jarvis sẽ đặt lịch giờ vàng ở lần chạy kế tiếp (mỗi giờ 7h–23h).</p>` : ""}`}
      </div>`;
      $("#detail-actions").innerHTML = approval.status === "pending" ? `<button class="btn primary" data-fbok="${approval.id}">Duyệt & để Jarvis đặt lịch</button><button class="btn danger" data-decide="${approval.id}:rejected">Bỏ bài này</button>` : "";
      return $("#detail").showModal();
    }
    const isScript = approval?.kind === "script";
    if (isScript && approval.status === "approved") {
      const used = state.prods?.filter((p) => p.script_id === approval.id) || [];
      $("#detail-actions").innerHTML = `
        <p class="muted" style="width:100%;margin:0 0 6px">Kịch bản đã duyệt${used.length ? ` · đang dùng cho video: ${used.map((p) => esc(p.title)).join(", ")}` : ""}. Sửa xong video dùng bản mới.</p>
        <input id="decide-note" placeholder="Ý cần thêm/sửa, ví dụ: thêm ý đệm giặt được, đổi hook sang con số 2000km">
        <button class="btn primary" data-sjarvis="${approval.id}">Nhờ Jarvis sửa</button>
        <button class="btn" data-sedit="${approval.id}">Tự sửa</button>`;
      return $("#detail").showModal();
    }
    $("#detail-actions").innerHTML = approval ? `
      <input id="decide-note" placeholder="${isScript ? "Ghi chỗ cần sửa, ví dụ: hook dùng con số 1.700km, bỏ đoạn 3" : "Chọn ý tưởng nào? ví dụ: chọn ý 2 và 5 (để trống = 3 ý đầu)"}">
      <button class="btn primary" data-decide="${approval.id}:approved">${isScript ? "Duyệt kịch bản" : "Duyệt & viết kịch bản"}</button>
      ${isScript ? `<button class="btn" data-decide="${approval.id}:revise">Yêu cầu sửa</button>` : ""}
      <button class="btn danger" data-decide="${approval.id}:rejected">Từ chối</button>` : "";
    $("#detail").showModal();
  }
  function alertBox(title, body) { openDetail(title, body, null); }
  $("#detail-close").addEventListener("click", () => $("#detail").close());

  // ======================= APP ĐIỆN THOẠI (PWA) =======================
  let deferred = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
  const isElectron = /Electron/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (isElectron || standalone) $("#install").classList.add("hidden");
  async function installApp() {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; return; }
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    $("#detail-title").textContent = "Cài Jarvis lên màn hình chính";
    $("#detail-body").innerHTML = md(ios
      ? "Trên iPhone (mở bằng Safari):\n\n1. Bấm nút **Chia sẻ** (ô vuông có mũi tên lên) ở thanh dưới.\n2. Kéo xuống, chọn **Thêm vào MH chính**.\n3. Bấm **Thêm**. Biểu tượng Jarvis sẽ nằm trên màn hình như một app."
      : "Trên Android (mở bằng Chrome):\n\n1. Bấm dấu **⋮** ở góc trên bên phải.\n2. Chọn **Thêm vào màn hình chính** (hoặc **Cài đặt ứng dụng**).\n3. Bấm **Thêm**.\n\nTrên máy tính: bấm biểu tượng cài đặt ở cuối thanh địa chỉ Chrome.");
    $("#detail-actions").innerHTML = "";
    $("#detail").showModal();
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // chỉnh số phút: bấm vào ô "Thời gian trả lại"
  document.addEventListener("dblclick", (e) => { if (e.target.closest(".kpi")) openMinutes(); });

  start();
})();
