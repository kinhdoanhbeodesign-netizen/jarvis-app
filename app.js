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
      .subscribe();
    setInterval(refreshAll, 30_000);
    setInterval(() => { if (state.view === "dash") loadDash(); }, 120_000);
    setInterval(tick, 1000); tick();
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
      sb.from("settings").select("key,value").in("key", ["autopilot", "autopilot_saved", "minutes", "goals", "mystats", "hot_hidden"]),
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
        <div><svg viewBox="0 0 24 24"><path d="M3 20h18M6 16v-3M10 16V9M14 16v-5M18 16V6"/></svg>Số liệu thật<br>YouTube · TikTok</div>
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
    const followers = rows.reduce((a, r) => a + (r.followers || 0), 0) || null;
    const h = getJSON("mystats", {})[p]?.h || [];
    const wk = h.filter((x) => x.d <= vnDay(Date.now() - 7 * 864e5)).pop() || h[0];
    const best = [...v30].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    return {
      rows, followers, fDelta: followers != null && wk && wk.d !== vnDay(Date.now()) ? followers - wk.f : null, fHist: h.map((x) => x.f),
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
    return fb.pages.map((pg) => { const h = pg.h || []; const l = h[h.length - 1], pv = h[h.length - 2]; return { name: pg.name, l, pv, hist: h.map((x) => x.f || 0) }; });
  }

  function renderMineMini() {
    const box = $("#mine-mini"); if (!box) return;
    const card = (p, body) => `<div class="panel kpi mini"><div class="top"><span class="ico" style="background:${PL[p].c}22;color:${PL[p].c}">${PL[p].ico}</span>${PL[p].n}</div>${body}</div>`;
    box.innerHTML = ["youtube", "tiktok"].map((p) => {
      const s = mineStats(p);
      if (!s) return card(p, `<p class="muted" style="margin:4px 0 0;font-size:13px">Chưa liên kết kênh.</p><button class="btn sm" data-view="mine">Liên kết kênh</button>`);
      return card(p, `<div class="v num">${s.followers != null ? nf(s.followers) : "?"}<small>follow</small></div>
        <div class="foot">${s.recent.length > 1 ? spark(s.recent.map((v) => v.views || 0), PL[p].c) : '<span class="spark"></span>'}${fDeltaTxt(s.fDelta)}</div>
        <span class="muted" style="font-size:12px">View TB 30 ngày <b style="color:var(--text)">${short(s.med)}</b> · ngách ${short(s.nicheMed)} · ${s.n30} video</span>`);
    }).join("") + (() => {
      const pages = fbStats();
      if (!pages.length || !pages.some((x) => x.l)) return card("facebook", `<p class="muted" style="margin:4px 0 0;font-size:13px">Facebook chưa có API – nhập số tuần 1 lần.</p><button class="btn sm" id="fb-edit">Nhập số Facebook</button>`);
      const tot = pages.reduce((a, x) => a + (x.l?.f || 0), 0), totPv = pages.reduce((a, x) => a + (x.pv?.f || x.l?.f || 0), 0);
      const reach = pages.reduce((a, x) => a + (x.l?.reach || 0), 0);
      return card("facebook", `<div class="v num">${nf(tot)}<small>follow · ${pages.length} page</small></div>
        <div class="foot">${spark(pages[0].hist, PL.facebook.c)}<span class="delta ${tot - totPv > 0 ? "up" : tot - totPv < 0 ? "down" : "flat"}">${tot - totPv >= 0 ? "+" : ""}${nf(tot - totPv)} kỳ trước</span></div>
        <span class="muted" style="font-size:12px">Tiếp cận 7 ngày <b style="color:var(--text)">${short(reach)}</b> · nhập ${fmt(pages[0].l?.at)}</span>`);
    })();
  }

  function renderMine() {
    if (!state.d) return;
    $("#mine-note").textContent = "YouTube, TikTok tự cập nhật mỗi sáng 6:00 · Facebook nhập tay";
    const panel = (p) => {
      const s = mineStats(p), P = PL[p];
      const head = `<div class="ph"><h3 style="display:flex;align-items:center;gap:10px"><span class="ico" style="background:${P.c}22;color:${P.c}">${P.ico}</span>${P.n}</h3>`;
      if (!s) return `<div class="panel">${head}</div>
        <p class="muted">Nhập kênh ${P.n} của anh để Jarvis theo dõi chỉ số mỗi ngày.</p>
        <div class="row"><input id="mine-in-${p}" placeholder="${p === "youtube" ? "@tenkenh hoặc link kênh YouTube" : "@username TikTok"}" style="flex:1;min-width:180px"><button class="btn primary" data-mine-add="${p}">Liên kết</button></div></div>`;
      const vs = s.nicheMed ? s.med / s.nicheMed : 0;
      const maxV = Math.max(1, ...s.recent.map((v) => v.views || 0));
      return `<div class="panel">${head}<span class="muted" style="font-size:12.5px">${s.rows.map((r) => r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name || r.handle || r.channel_id)}</a>` : esc(r.handle || r.channel_id)).join(", ")}</span></div>
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
        <div class="row"><button class="btn sm danger" data-mine-unlink="${p}">Bỏ liên kết</button></div></div>`;
    };
    const fb = fbStats();
    const fbPanel = `<div class="panel"><div class="ph"><h3 style="display:flex;align-items:center;gap:10px"><span class="ico" style="background:${PL.facebook.c}22;color:${PL.facebook.c}">${PL.facebook.ico}</span>Facebook</h3><button class="btn sm" id="fb-edit">Cập nhật số</button></div>
      <p class="muted" style="font-size:12.5px;margin-top:0">${getJSON("mystats", {}).facebook?.auto ? "Tự cập nhật mỗi sáng 6:00 qua Meta API. Tiếp cận = số người xem nội dung 7 ngày." : "Chưa kết nối Meta API: tạm nhập số tay từ Meta Business Suite › Thông tin chi tiết (1 phút/tuần)."}</p>
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
  state.wk = 0;
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
        <span class="gt">${esc(g.title)}${g.auto && !compact ? `<small>${AUTO[g.auto].replace("Tự đếm: ", "tự đếm ")}</small>` : ""}</span>
        ${compact ? "" : `<span class="gstep">${g.target ? `<button class="btn sm" data-gstep="${g.id}:-1" aria-label="Bớt">−</button><b class="num">${d}/${g.target}</b><button class="btn sm" data-gstep="${g.id}:1" aria-label="Thêm">+</button><small>${esc(g.unit || "")}</small>` : `<small class="muted">đánh dấu khi xong</small>`}</span>`}
        <span class="gp"><span class="track"><i style="width:${p}%;background:${p >= 100 ? "var(--g)" : p >= 50 ? "var(--blue)" : "var(--amber)"}"></i></span><b class="num">${p}%</b></span>
        ${compact ? "" : `<button class="btn sm danger gdel" data-gdel="${g.id}" aria-label="Xóa">✕</button>`}
      </div>`;
    }).join("");
  }
  function overall(list, k) { return list.length ? Math.round(list.reduce((a, g) => a + gPct(g, k), 0) / list.length) : 0; }

  function renderGoals() {
    const k = weekStart(state.wk), list = goalsAll()[k] || [];
    $("#wk-label").textContent = (state.wk === 0 ? "Tuần này · " : "") + wkLabel(k);
    const o = overall(list, k), done = list.filter((g) => gPct(g, k) >= 100).length;
    $("#goals-box").innerHTML = `
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
    const k = weekStart(0), list = goalsAll()[k] || [];
    if (!list.length) return (box.innerHTML = `<div class="empty" style="padding:20px">Chưa đặt mục tiêu tuần này. <a href="#" data-go="goals">Đặt ngay</a></div>`);
    const o = overall(list, k);
    box.innerHTML = `<div class="gmini-top"><div class="ring sm" style="--p:${o}"><b class="num">${o}%</b></div><span class="muted">${wkLabel(k)} · ${list.filter((g) => gPct(g, k) >= 100).length}/${list.length} xong</span></div>` + goalRows(list.slice(0, 6), k, true);
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
      ms.facebook = { pages }; await saveJSON("mystats", ms);
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
      const isMini = !!el.closest("#goal-mini"); const key = isMini ? weekStart(0) : k;
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
    if (ds.hothide) { const h = getJSON("hot_hidden", []); h.push(ds.hothide); await saveJSON("hot_hidden", h.slice(-500)); renderHot(); renderHotMini(); return true; }
    return false;
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
    $("#assist-chips").innerHTML = `<span class="muted" style="font-size:12px;align-self:center;letter-spacing:1px">TRỢ LÝ</span>` +
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
      return refreshAll();
    }
    if (el.dataset.open) {
      const ap = state.approvals.find((x) => x.id == el.dataset.open);
      return openDetail(ap.title, ap.body, ap.status === "pending" || ap.status === "error" ? ap : null);
    }
    if (el.dataset.openrun) {
      const r = state.runs.find((x) => x.id == el.dataset.openrun);
      return openDetail(r.tasks?.title || "Lần chạy", r.status === "error" ? "Lỗi: " + r.error : stripPreamble(r.output) || "(trống)");
    }
    if (el.dataset.decide) {
      const [id, status] = el.dataset.decide.split(":");
      const note = $("#decide-note")?.value?.trim() || null;
      if (status === "revise" && !note) { $("#decide-note").focus(); $("#decide-note").placeholder = "Ghi rõ chỗ cần sửa trước khi bấm Yêu cầu sửa"; return; }
      await sb.from("approvals").update({ status, note, decided_at: new Date().toISOString() }).eq("id", id);
      $("#detail").close();
      const ap = state.approvals.find((x) => x.id == id);
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
    const active = ["pending", "queued", "writing"];
    const list = state.approvals.filter((a) => (state.inbox === "pending" ? active.includes(a.status) : !active.includes(a.status)));
    const KIND = { ideas: "Ý tưởng", script: "Kịch bản" };
    const ST = { approved: ["Đã duyệt", "status-ok"], rejected: ["Từ chối", "status-error"], revise: ["Đang yêu cầu sửa", "muted"], revised: ["Đã có bản sửa", "muted"], error: ["Lỗi – bấm Xem để thử lại", "status-error"] };
    $("#inbox-list").innerHTML = list.length ? list.map((a) => `
      <article class="card">
        <div class="body">
          <span class="title">${esc(a.title)}</span>
          <span class="meta"><span class="tag">${KIND[a.kind] || esc(a.kind)}</span>${a.version > 1 ? `<span class="tag">Bản ${a.version}</span>` : ""}${fmt(a.created_at)}
          ${ST[a.status] ? ` · <b class="${ST[a.status][1]}">${ST[a.status][0]}</b>` : ""}</span>
        </div>
        ${a.status === "queued" || a.status === "writing" ? `<span class="status-running" style="font-size:13px">Jarvis đang viết…</span>`
          : `<button class="btn sm ${a.status === "pending" ? "primary" : ""}" data-open="${a.id}">${a.status === "pending" ? "Xem & duyệt" : "Xem"}</button>`}
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
    const isScript = approval?.kind === "script";
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
