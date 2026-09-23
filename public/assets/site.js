/* 陆耀威个人站 · 访客端脚本（蓝图档案版）
   内容一律来自 GET /api/content 动态渲染，对话走 POST /api/chat（SSE 流式）。
   字段名以 docs/API_CONTRACT.md 为准；页面切换用 hash 路由（#/home…#/internship）。 */
(() => {
  'use strict';

  // 接口基址：默认同源；联调/自测可用 ?api=http://host:port 覆盖。
  const API_BASE = new URLSearchParams(location.search).get('api') || '';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  };

  const body = (name) => document.querySelector('[data-body="' + name + '"]');

  const fill = (node, text) => {
    if (node && text !== undefined && text !== null && text !== '') node.textContent = text;
  };

  const emptyNote = (box) => box.appendChild(el('p', 'empty-note', '这一栏暂时没有内容。'));

  /* ---------- 页面定义（hash 路由） ---------- */
  const PAGES = [
    { key: 'home',       no: '01', label: '首页' },
    { key: 'overview',   no: '02', label: '全览' },
    { key: 'projects',   no: '03', label: '项目' },
    { key: 'progress',   no: '04', label: '进程' },
    { key: 'campus',     no: '05', label: '校园' },
    { key: 'honors',     no: '06', label: '获奖' },
    { key: 'internship', no: '07', label: '实习' }
  ];
  const PAGE_KEYS = PAGES.map((p) => p.key);
  const keyOf = (key) => PAGES.find((p) => p.key === key) || PAGES[0];

  // 旧锚点（#profile/#projects/…）映射到对应新页，避免旧分享链接失效
  const LEGACY_HASH = {
    profile: 'home', projects: 'projects', progress: 'progress',
    campus: 'campus', honors: 'honors', internship: 'internship'
  };

  let CURRENT = null; // null = 尚未定位，首屏 navigate 不因“相同页”短路

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return 'home';
    if (LEGACY_HASH[raw]) return LEGACY_HASH[raw];
    return PAGE_KEYS.includes(raw) ? raw : 'home';
  }

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = () => window.matchMedia('(pointer: fine)').matches;

  /* ---------- v2：切页变体（P0/P4：默认浮动，5 变体可选，单值站点配置） ---------- */
  const FX_NAMES = ['float', 'sheet', 'fade', 'zoom', 'soft'];
  let pageFx = 'float';
  // 站点配置单值：localStorage 优先，其次 <html data-fx="…"> 静态配置，最后默认 float
  try {
    const saved = localStorage.getItem('site-fx');
    if (FX_NAMES.includes(saved)) pageFx = saved;
  } catch (e) { /* 隐私模式等：回落到静态配置 */ }
  if (!FX_NAMES.includes(pageFx)) {
    const htmlFx = document.documentElement.getAttribute('data-fx');
    if (FX_NAMES.includes(htmlFx)) pageFx = htmlFx;
  }
  // 暴露站点配置单值切换（供站主日后换气质 / CDP 断言）
  window.setPageFx = (name) => {
    if (!FX_NAMES.includes(name)) return false;
    pageFx = name;
    try { localStorage.setItem('site-fx', name); } catch (e) { /* noop */ }
    return true;
  };
  window.getPageFx = () => pageFx;

  /* ---------- v2 P2：切页水滴音（Web Audio 现场合成，零外部资源） ---------- */
  let dropCtx = null;
  const ensureDropCtx = () => {
    if (dropCtx || reducedMotion()) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { dropCtx = new AC(); } catch (e) { dropCtx = null; }
  };
  // 用户首次交互时解锁 AudioContext（首播即解锁，无需二次授权）
  const unlockDrop = () => {
    ensureDropCtx();
    if (dropCtx && dropCtx.state === 'suspended') dropCtx.resume().catch(() => {});
  };
  document.addEventListener('pointerdown', unlockDrop, { passive: true });
  document.addEventListener('keydown', unlockDrop, { passive: true });

  const playDrop = () => {
    if (reducedMotion() || !dropCtx) return;
    const ctx = dropCtx;
    const run = () => {
      if (ctx.state !== 'running') return;
      try {
        const t0 = ctx.currentTime + 0.01;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        // 一滴水：短促上行“啵” + 快速下滑，整体 ≤200ms
        osc.frequency.setValueAtTime(900, t0);
        osc.frequency.exponentialRampToValueAtTime(430, t0 + 0.07);
        osc.frequency.exponentialRampToValueAtTime(210, t0 + 0.15);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.19);
      } catch (e) { /* 现场合成失败静默 */ }
    };
    if (ctx.state === 'running') run();
    else if (ctx.state === 'suspended') ctx.resume().then(run).catch(() => {});
  };

  /* ---------- v2 ⑤：AI 面板波点 focus 点亮（420ms / 60ms stagger，单次不循环） ---------- */
  const flashDots = (svg) => {
    if (!svg || reducedMotion()) return;
    svg.classList.remove('lit');
    void svg.getBoundingClientRect(); // 强制回流，保证每次可重放
    svg.classList.add('lit');
    clearTimeout(svg._dotTimer);
    svg._dotTimer = setTimeout(() => svg.classList.remove('lit'), 460);
  };
  function initDots() {
    const qaInput = $('#qa-input');
    const chatInput = $('#chat-input');
    const qaDots = document.querySelector('[data-dots="qa"]');
    const chatDots = document.querySelector('[data-dots="chat"]');
    if (qaInput && qaDots) qaInput.addEventListener('focus', () => flashDots(qaDots));
    if (chatInput && chatDots) chatInput.addEventListener('focus', () => flashDots(chatDots));
  }

  /* ---------- v2 ⑥：7 页信号线 —— 谐波合成 / 描线重绘 hover 变形 ----------
     首页：折线(JAG)→正弦(SIN) 顶点插值；项目页：SIN→+3→+5→+7→方波(谐波累加)；
     其余页：自身图案单次描线重绘（stroke-dash，≤420ms）。全部仅 pointer:fine，
     reduced-motion / 移动端不注册（图案静态显示）。 */
  const SIG_VIEW = 640;
  const SIG_N = 96; // 与 index.html 静态路径同参数（2 周期 / 96 采样 / 22 幅）
  const sigSineY = (x) => 32 - 22 * Math.sin((2 * Math.PI * 2 * x) / 640);
  // v1 首页旧折线（hover 起态 = JAG 顶点，供 折线→正弦 插值）
  const SIG_JAG = [
    [0, 32], [52, 32], [76, 10], [100, 54], [124, 32], [176, 32], [208, 12], [240, 52], [272, 32],
    [334, 32], [372, 6], [410, 58], [448, 32], [512, 32], [548, 18], [584, 46], [640, 32]
  ];
  const jagYAt = (x) => {
    const pts = SIG_JAG;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  };
  const sigPathFromY = (yfn) => {
    let d = '';
    for (let i = 0; i <= SIG_N; i++) {
      const x = (i / SIG_N) * SIG_VIEW;
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yfn(x).toFixed(1);
    }
    return d;
  };
  // 谐波累加（项目页方波逐级合成）：y = Σ (1/k)·sin(2π·2k·x/640)，按振幅 22 归一
  const sigHarmY = (harmonics) => (x) => {
    let s = 0;
    harmonics.forEach((k) => { s += Math.sin((2 * Math.PI * 2 * k * x) / 640) / k; });
    return 32 - 22 * (s / 1.2); // 约化系数保证峰值 ≈22
  };
  const runSigMorph = (el, frames, stepMs) => {
    if (el._sigTimer) clearInterval(el._sigTimer);
    const path = el.querySelector('.sig-path');
    if (!path) return;
    let i = 0;
    el.classList.add('morphing');
    const step = () => {
      if (!el._sigTimer) return; // 已被 mouseleave 终止
      path.setAttribute('d', frames[i]);
      i += 1;
      if (i >= frames.length) {
        clearInterval(el._sigTimer);
        el._sigTimer = 0;
        el.classList.remove('morphing');
      }
    };
    el._sigTimer = setInterval(step, stepMs);
    step();
  };
  function initSigPatterns() {
    if (reducedMotion() || !finePointer()) return;
    $$('.sig').forEach((svg) => {
      const path = svg.querySelector('.sig-path');
      if (!path) return;
      const type = svg.dataset.sig || '';
      svg.addEventListener('mouseenter', () => {
        if (reducedMotion()) return;
        // 终止旧动画
        if (svg._sigTimer) { clearInterval(svg._sigTimer); svg._sigTimer = 0; }
        svg.classList.remove('draw', 'morphing');
        if (type === 'home') {
          // 折线(JAG) → 正弦(SIN)：5 帧顶点插值，每帧 100ms ≤600ms
          const frames = [];
          const steps = 5;
          for (let f = 0; f < steps; f++) {
            const t = f / (steps - 1);
            const yfn = (x) => jagYAt(x) + (sigSineY(x) - jagYAt(x)) * t;
            frames.push(sigPathFromY(yfn));
          }
          frames[frames.length - 1] = svg._baseD; // 终帧 = 静态正弦，离开无跳变
          runSigMorph(svg, frames, 100);
        } else if (type === 'projects') {
          // 正弦 → +3 → +5 → +7 → 方波(≈基波+3+5+7+9+11)：逐级合成
          const frames = [
            sigPathFromY(sigHarmY([1])),
            sigPathFromY(sigHarmY([1, 3])),
            sigPathFromY(sigHarmY([1, 3, 5])),
            sigPathFromY(sigHarmY([1, 3, 5, 7])),
            sigPathFromY(sigHarmY([1, 3, 5, 7, 9, 11]))
          ];
          frames[frames.length - 1] = svg._baseD; // 终帧 = 静态方波，离开无跳变
          runSigMorph(svg, frames, 110);
        } else {
          // 其余 5 页：描线重绘（dash 0→全 420ms，mouseleave 复位）
          void path.getBoundingClientRect();
          svg.classList.add('draw');
        }
      });
      svg.addEventListener('mouseleave', () => {
        if (svg._sigTimer) { clearInterval(svg._sigTimer); svg._sigTimer = 0; }
        svg.classList.remove('draw', 'morphing');
        if (svg._baseD) path.setAttribute('d', svg._baseD);
      });
      svg._baseD = path.getAttribute('d');
    });
  }

  /* ---------- 页切换：View Transitions 优先，class 回退 ---------- */
  function applyPage(key, animate) {
    const page = document.getElementById('page-' + key);
    if (!page) return;
    $$('.page').forEach((p) => { p.hidden = true; });
    page.hidden = false;
    CURRENT = key;
    updateToc();
    updatePageNav();
    updateFab();
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      // 页可见后立即处理渐入项：视口内马上点亮，其余由 IO/兜底接管（内容永不可见即失败）
      revealPass(page);
    });
  }

  let navTimer = 0; // 待执行的 class 回退 apply
  let navGen = 0;   // 递增序号：快速连续切页时作废过期切换
  function cancelPendingNav() {
    if (navTimer) { clearTimeout(navTimer); navTimer = 0; }
    $$('.page').forEach((p) => p.classList.remove('leaving', 'entering', 'start'));
  }

  function navigate(key, animate) {
    key = keyOf(key).key;
    if (CURRENT && key === CURRENT) { window.scrollTo(0, 0); return; }
    const gen = ++navGen;
    const doApply = () => applyPage(key, animate);

    // v2 ②：切页变体（默认 float）注入 + sheet 方向（下一/上一由页序决定）
    document.documentElement.dataset.fx = pageFx;
    const fromIdx = CURRENT ? PAGE_KEYS.indexOf(CURRENT) : -1;
    const toIdx = PAGE_KEYS.indexOf(key);
    const fxDir = toIdx > fromIdx ? 1 : -1;
    document.documentElement.style.setProperty('--fx-dir', fxDir);

    // v2 P2：真实切页（非首屏、有动效、非 reduce）触发水滴音
    if (animate && !reducedMotion()) playDrop();

    if (animate && !reducedMotion() && document.startViewTransition) {
      try {
        const vt = document.startViewTransition(doApply);
        // 连切时旧过渡会被浏览器中止（Transition was skipped）：吞掉即可，不影响新页落位
        if (vt && vt.finished && vt.finished.catch) vt.finished.catch(() => {});
      } catch (e) { doApply(); }
    } else if (animate && !reducedMotion()) {
      if (navTimer) {
        // 过渡尚未完成又切页：取消半程淡出，直接落位新页，避免旧页残留/渐入漏触发
        cancelPendingNav();
        applyPage(key, animate);
        return;
      }
      // class 回退：旧页淡出 + 新页滑入（复用 .page.leaving/.entering）
      const old = document.querySelector('.page:not([hidden])');
      if (old) old.classList.add('leaving');
      navTimer = setTimeout(() => {
        navTimer = 0;
        if (gen !== navGen) return; // 已被更新的切换取代
        if (old) old.classList.remove('leaving');
        const page = document.getElementById('page-' + key);
        if (!page) return;
        page.classList.remove('entering', 'start');
        void page.offsetWidth; // 强制回流，确保起点生效
        page.classList.add('entering', 'start');
        doApply();
        requestAnimationFrame(() => requestAnimationFrame(() => page.classList.remove('start')));
        setTimeout(() => page.classList.remove('entering'), 500);
      }, 280);
    } else {
      doApply();
    }
  }

  function initRouter() {
    window.addEventListener('hashchange', () => navigate(parseHash(), true));
    navigate(parseHash(), false); // 首屏无动画直接定位
  }

  /* ---------- 顶部目录高亮 ---------- */
  function updateToc() {
    $$('#toc a').forEach((a) => a.classList.toggle('current', a.dataset.page === CURRENT));
  }

  /* ---------- 底部翻页导航 ---------- */
  function updatePageNav() {
    const nav = $('#page-nav');
    if (!nav) return;
    const idx = PAGE_KEYS.indexOf(CURRENT);
    const prev = idx > 0 ? PAGE_KEYS[idx - 1] : null;
    const next = idx < PAGE_KEYS.length - 1 ? PAGE_KEYS[idx + 1] : null;

    nav.textContent = '';
    const mk = (key, label, cls, disabled) => {
      if (disabled) {
        // 禁用态直接渲染为 span（无 href），视觉禁用与语义一致，避免 javascript: URL
        const s = el('span', cls, label);
        s.setAttribute('aria-disabled', 'true');
        return s;
      }
      const a = el('a', cls, label);
      a.href = '#/' + key;
      return a;
    };
    nav.appendChild(mk(prev, '← ' + (prev ? keyOf(prev).label : ''), 'pn-arrow', !prev));

    const list = el('div', 'pn-list');
    PAGES.forEach((p) => {
      const a = el('a', 'pn-item' + (p.key === CURRENT ? ' current' : ''), '');
      a.href = '#/' + p.key;
      a.appendChild(el('span', 'pn-no', p.no));
      a.appendChild(document.createTextNode(p.label));
      list.appendChild(a);
    });
    nav.appendChild(list);

    nav.appendChild(mk(next, (next ? keyOf(next).label : '') + ' →', 'pn-arrow', !next));
  }

  /* ---------- 浮动问答入口：首页隐藏（AI 面板即主角），其他页显示 ---------- */
  function updateFab() {
    const fab = $('#ask-open-fab');
    if (!fab) return;
    fab.hidden = CURRENT === 'home';
    if (!fab.hidden) fab.classList.remove('fab-hide'); // 复位淡出态
  }

  /* ---------- 滚动渐入（允许清单 2） ----------
     可靠性设计（任何加载/切页时序下内容都可见）：
     1) IO 点亮进入视口的条目（仅触发一次）；
     2) 渲染/翻页后「当前可见页·视口内」条目同步点亮，不等 IO 首帧回调；
     3) 1.2s 强制兜底：仍未点亮的 .reveal 一律加 .in（含截图/受限环境/隐藏页元素）；
     4) prefers-reduced-motion 或无 IO 时全部即时显示。 */
  let revealIO = null;
  const REVEAL_FALLBACK_MS = 1200;

  const lightIn = (n) => n.classList.add('in');

  // 是否位于某个 display:none/[hidden] 祖先内（隐藏页元素 IO 永不触发，需兜底路径判断）
  function withinHiddenAncestor(n) {
    let cur = n;
    while (cur && cur !== document.documentElement) {
      if (cur.hidden) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // 粗略可见性：非隐藏祖先，且矩形与视口在垂直方向相交
  function inViewport(n) {
    if (withinHiddenAncestor(n)) return false;
    const r = n.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.top < vh && r.bottom > 0;
  }

  function scheduleRevealFallback(targets) {
    setTimeout(() => targets.forEach(lightIn), REVEAL_FALLBACK_MS);
  }

  function watchReveals(root) {
    const targets = Array.from((root || document).querySelectorAll('.reveal:not(.in)'));
    if (!targets.length) return;
    if (reducedMotion() || !('IntersectionObserver' in window)) {
      targets.forEach(lightIn);
      return;
    }
    if (!revealIO) {
      revealIO = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { lightIn(en.target); revealIO.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    }
    targets.forEach((n) => revealIO.observe(n));
    // 渲染时若正处于可见页且条目在视口内：立即点亮（不等 IO 异步首帧）
    targets.forEach((n) => { if (!n.classList.contains('in') && inViewport(n)) lightIn(n); });
    // 兜底：IO 未触发（截图/受限环境/隐藏页元素）时 1.2s 后强制显示
    scheduleRevealFallback(targets);
  }

  // 页面被显示时调用：点亮视口内条目 + 为本页剩余条目安排 1.2s 兜底
  function revealPass(page) {
    const targets = Array.from((page || document).querySelectorAll('.reveal:not(.in)'));
    if (!targets.length) return;
    targets.forEach((n) => { if (inViewport(n)) lightIn(n); });
    scheduleRevealFallback(targets);
  }

  /* ---------- 图片：缩略图 + 全屏放大浮层 ---------- */
  const lb = { root: null, img: null, open: false };
  function ensureLightbox() {
    if (lb.root) return;
    const root = el('div', 'lightbox');
    root.hidden = true;
    const img = el('img', 'lightbox-img');
    img.alt = '';
    const close = el('button', 'lightbox-close', '关闭');
    close.type = 'button';
    root.appendChild(img);
    root.appendChild(close);
    root.addEventListener('click', (e) => { if (e.target === root) closeLightbox(); });
    close.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.open) closeLightbox(); });
    document.body.appendChild(root);
    lb.root = root;
    lb.img = img;
  }
  function openLightbox(src) {
    ensureLightbox();
    lb.img.src = src;
    lb.open = true;
    lb.root.hidden = false;
  }
  function closeLightbox() {
    if (!lb.root) return;
    lb.open = false;
    lb.root.hidden = true;
  }
  function renderThumb(box, image, imageWidth, alt) {
    const url = (image || '').trim();
    if (!url) return;
    const w = [40, 60, 80, 100].includes(Number(imageWidth)) ? Number(imageWidth) : 100;
    const btn = el('button', 'item-thumb');
    btn.type = 'button';
    btn.style.width = w + '%';
    btn.setAttribute('aria-label', '查看大图：' + (alt || '图片'));
    const img = el('img');
    img.src = url;
    img.alt = alt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    btn.appendChild(img);
    btn.addEventListener('click', () => openLightbox(url));
    box.appendChild(btn);
  }

  /* ---------- hero 光标视差（允许清单 5）：仅首页 hero ---------- */
  function initHeroParallax() {
    const hero = document.querySelector('.blueprint-hero');
    if (!hero || reducedMotion() || !finePointer()) return;
    const grid = hero.querySelector('.hero-grid');
    const wave = hero.querySelector('.hero-wave');
    let raf = 0;
    hero.style.cursor = 'crosshair';
    hero.addEventListener('mousemove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = hero.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        if (grid) grid.style.transform = 'translate(' + (nx * 4).toFixed(1) + 'px,' + (ny * 3).toFixed(1) + 'px)';
        if (wave) wave.style.transform = 'translate(' + (nx * -3).toFixed(1) + 'px,' + (ny * -2).toFixed(1) + 'px)';
      });
    });
    hero.addEventListener('mouseleave', () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (grid) grid.style.transform = '';
      if (wave) wave.style.transform = '';
    });
  }

  /* ---------- 渲染：GET /api/content ---------- */

  // 首页 hero 身份行
  function renderHero(p) {
    fill($('#intro-name'), p.name);
    fill($('#intro-intent'), p.intent);
    $('#intro-meta').textContent = [p.email, p.location, p.politics].filter(Boolean).join(' / ');
  }

  // 首页「自我介绍」（教育/技能/自我评价 + 简介）
  function renderHomeAbout(p) {
    const box = body('home-about');
    box.textContent = '';
    if (p.summary) {
      const sumBox = el('div', 'summary');
      sumBox.appendChild(el('p', 'block-label', '个人简介'));
      sumBox.appendChild(el('p', 'summary-text', p.summary));
      box.appendChild(sumBox);
    }
    const edu = p.education || {};
    if (edu.school || edu.major || edu.period || edu.gpa || edu.courses) {
      const eduBox = el('div', 'edu');
      eduBox.appendChild(el('p', 'block-label', '教育背景'));
      if (edu.school) eduBox.appendChild(el('h3', 'edu-school', edu.school));
      if (edu.major) eduBox.appendChild(el('p', 'edu-major', edu.major));
      const eduMeta = [edu.period, edu.gpa].filter(Boolean).join(' · ');
      if (eduMeta) eduBox.appendChild(el('p', 'edu-meta', eduMeta));
      if (edu.courses) eduBox.appendChild(el('p', 'edu-courses', edu.courses));
      box.appendChild(eduBox);
    }
    const skills = Array.isArray(p.skills) ? p.skills : [];
    if (skills.length) {
      const skillsBox = el('div', 'skills');
      skillsBox.appendChild(el('p', 'block-label', '技能'));
      skills.forEach((s) => {
        const row = el('div', 'skill-row');
        row.appendChild(el('p', 'skill-group', s.group));
        row.appendChild(el('p', 'skill-items', s.items));
        skillsBox.appendChild(row);
      });
      box.appendChild(skillsBox);
    }
    if (p.selfEval) {
      const evalBox = el('div', 'selfeval');
      evalBox.appendChild(el('p', 'block-label', '自我评价'));
      evalBox.appendChild(el('p', 'selfeval-text', p.selfEval));
      box.appendChild(evalBox);
    }
  }

  // 首页「项目」区（v2 ⑦）：P-01…05 全项目纵向 —— 分层大标题 + 一句话 + mono 参数行，
  // 整行链接 → /p/:slug；桌面 hover ≥120ms 浮右侧预览夹（复用详情 diagram；骨架/无图显印戳）。
  const TIER_LABEL = { flagship: 'FLAGSHIP', core: 'CORE', archive: 'ARCHIVE' };
  const PREVIEW_DELAY_MS = 120;

  // 详情文档按 slug 懒加载并缓存（预览夹与详情页 diagram 同一 URL，零重复资产）
  const docCache = new Map();
  const fetchDocCached = (slug) => {
    if (!slug) return Promise.resolve(null);
    if (!docCache.has(slug)) {
      docCache.set(
        slug,
        fetch(API_BASE + '/api/project/' + encodeURIComponent(slug), { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      );
    }
    return docCache.get(slug);
  };

  function renderProjectsHome(list) {
    const box = body('projects-home');
    box.textContent = '';
    const items = (Array.isArray(list) ? list : []).filter((it) => it.slug || it.name);
    if (!items.length) return emptyNote(box);
    const rows = el('div', 'plist');
    items.forEach((it, i) => {
      const slug = it.slug || '';
      const tier = it.tier || 'archive';
      const row = el('a', 'pl-row reveal');
      row.href = '/p/' + encodeURIComponent(slug);
      row.dataset.slug = slug;
      row.dataset.tier = tier;
      row.appendChild(el('span', 'pl-no', 'P-' + String(i + 1).padStart(2, '0')));
      const copy = el('div', 'pl-copy');
      const titleLine = el('div', 'pl-titleline');
      titleLine.appendChild(el('h3', 'pl-title', it.name || ''));
      titleLine.appendChild(el('span', 'pl-badge', TIER_LABEL[tier] || ''));
      copy.appendChild(titleLine);
      if (it.line) copy.appendChild(el('p', 'pl-line', it.line));
      if (it.param) copy.appendChild(el('p', 'pl-param', it.param));
      row.appendChild(copy);
      // 预览夹（aria-hidden：纯装饰浮层，点击整行即进详情）
      const clip = el('div', 'pv-clip');
      clip.setAttribute('aria-hidden', 'true');
      clip.appendChild(el('p', 'pv-kicker', 'PROJECT PREVIEW'));
      const bodyBox = el('div', 'pv-body');
      bodyBox.appendChild(el('p', 'pv-placeholder', '…'));
      clip.appendChild(bodyBox);
      clip.appendChild(el('p', 'pv-param', it.param || ''));
      const pts = el('ul', 'pv-pts');
      clip.appendChild(pts);
      row.appendChild(clip);
      row._pv = { clip, bodyBox, pts };
      rows.appendChild(row);
    });
    box.appendChild(rows);
    watchReveals(rows);
    initProjectPreview(rows);
  }

  // hover ≥120ms 触发预览夹（防扫过扰动）；鼠标移出即收回；仅 pointer:fine + 非 reduced
  function initProjectPreview(root) {
    if (reducedMotion() || !finePointer()) return;
    const rows = Array.from(root.querySelectorAll('.pl-row'));
    let timer = 0;
    const hideAll = () => rows.forEach((r) => r.classList.remove('pv-on'));
    rows.forEach((row) => {
      const pv = row._pv;
      if (!pv) return;
      let filled = false;
      const fill = (doc) => {
        const sources = (doc && Array.isArray(doc.results) && doc.results.length)
          ? doc.results
          : (doc && Array.isArray(doc.bullets) && doc.bullets.length ? doc.bullets : []);
        pv.bodyBox.textContent = '';
        if (doc && doc.diagram && !doc.skeleton) {
          const img = document.createElement('img');
          img.className = 'pv-img';
          img.src = doc.diagram;
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          pv.bodyBox.appendChild(img);
        } else {
          // 骨架态：只显示「详细内容整理中」印戳，不画没有依据的流程图
          const stamp = el('p', 'pv-stamp');
          stamp.appendChild(el('span', 'skeleton-mark', '详细内容整理中'));
          pv.bodyBox.appendChild(stamp);
        }
        pv.pts.textContent = '';
        sources.slice(0, 3).forEach((s) => pv.pts.appendChild(el('li', null, s)));
        pv.pts.hidden = pv.pts.children.length === 0;
        filled = true;
      };
      row.addEventListener('mouseenter', () => {
        hideAll();
        clearTimeout(timer);
        timer = setTimeout(() => {
          row.classList.add('pv-on');
          if (!filled) {
            const slug = row.dataset.slug;
            if (slug) fetchDocCached(slug).then((doc) => { if (row.classList.contains('pv-on')) fill(doc); });
          }
        }, PREVIEW_DELAY_MS);
      });
      row.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        row.classList.remove('pv-on');
      });
    });
  }

  // 首页「全部档案」：六板块一行摘要入口
  function renderHomeIndex(data) {
    const box = body('home-index');
    box.textContent = '';
    const rows = el('div', 'index-rows');
    const groups = [
      { key: 'overview',   no: '02', title: '全览',   hint: '六类档案一页看全', count: null },
      { key: 'projects',   no: '03', title: '项目',   hint: '5 个项目 · 点击标题看详情', count: (data.projects || []).length },
      { key: 'progress',   no: '04', title: '进程',   hint: '各项目当前状态与说明', count: (data.progress || []).length },
      { key: 'campus',     no: '05', title: '校园',   hint: '校园经历与基地工作', count: (data.campus || []).length },
      { key: 'honors',     no: '06', title: '获奖',   hint: '竞赛与荣誉记录', count: (data.honors || []).length },
      { key: 'internship', no: '07', title: '实习',   hint: '实习经历与收获', count: (data.internship || []).length }
    ];
    groups.forEach((g) => {
      const a = el('a', 'index-row reveal', '');
      a.href = '#/' + g.key;
      a.appendChild(el('span', 'index-no', g.no));
      a.appendChild(el('span', 'index-title', g.title));
      const n = g.count && g.count > 0 ? String(g.count) + ' 项 · ' : '';
      a.appendChild(el('span', 'index-snippet', n + g.hint));
      a.appendChild(el('span', 'index-go', '前往 →'));
      rows.appendChild(a);
    });
    box.appendChild(rows);
    watchReveals(rows);
  }

  /* 全览页：六组索引（一级标题 + 二级标题 + 一行摘要 + 跳转） */
  function renderOverview(data) {
    const root = $('#ov-groups');
    root.textContent = '';
    const groups = [
      { key: 'projects',   no: '03', title: '项目',   list: data.projects || [],   line: (it) => it.name,            sub: (it) => it.stack || '',        to: (it) => '/p/' + encodeURIComponent(it.slug || '') },
      { key: 'progress',   no: '04', title: '进程',   list: data.progress || [],   line: (it) => it.project,         sub: (it) => it.note || '',         to: (it) => '#/progress' },
      { key: 'campus',     no: '05', title: '校园',   list: data.campus || [],     line: (it) => it.title,           sub: (it) => it.org || it.detail || '', to: (it) => '#/campus' },
      { key: 'honors',     no: '06', title: '获奖',   list: data.honors || [],     line: (it) => it.name,            sub: (it) => it.detail || '',       to: (it) => '#/honors' },
      { key: 'internship', no: '07', title: '实习',   list: data.internship || [], line: (it) => it.company,         sub: (it) => it.role || '',         to: (it) => '#/internship' }
    ];
    groups.forEach((g) => {
      const group = el('section', 'ov-group');
      const head = el('header', 'sec-head');
      head.appendChild(el('p', 'sec-no', g.no + ' / ' + g.key.toUpperCase()));
      head.appendChild(el('h2', null, g.title));
      group.appendChild(head);
      const frame = el('div', 'frame');
      const secBody = el('div', 'sec-body');
      if (!g.list.length) {
        secBody.appendChild(el('p', 'ov-group-empty', '这一栏还没有内容。'));
      } else {
        const rows = el('div', 'ov-rows');
        g.list.forEach((it, i) => {
          const a = el('a', 'ov-row reveal', '');
          if (g.to && g.to(it)) a.href = g.to(it);
          if (g.key === 'projects') a.dataset.tier = it.tier || 'archive'; // v2 ③：标题字重档
          a.appendChild(el('span', 'ov-no', String(i + 1).padStart(2, '0')));
          a.appendChild(el('span', 'ov-title', g.line(it) || ''));
          if (g.sub(it)) a.appendChild(el('span', 'ov-snippet', g.sub(it)));
          a.appendChild(el('span', 'ov-detail', /^https?:/.test(a.href) ? '详情 →' : '前往 →'));
          rows.appendChild(a);
        });
        secBody.appendChild(rows);
        watchReveals(rows);
      }
      frame.appendChild(secBody);
      group.appendChild(frame);
      root.appendChild(group);
    });
  }

  /* 项目页：非均质卡片（旗舰大卡 + 错落小卡） */
  function renderProjects(list) {
    const grid = $('#proj-grid');
    grid.textContent = '';
    if (!list.length) return emptyNote(grid);
    const FEATURED = new Set(['eda-agent-bridge']); // 唯一 F0 旗舰（全宽大卡）；wei-plus 等降为普通卡片
    list.forEach((item, i) => {
      const featured = FEATURED.has(item.slug);
      const card = el('article', 'proj-card reveal' + (featured ? ' featured' : ''));
      card.dataset.tier = item.tier || 'archive'; // v2 ③：字重档（S 700 / A 600 / B 500）驱动
      card.appendChild(el('p', 'proj-no', 'P-' + String(i + 1).padStart(2, '0') + ' · ' + (item.tag || '项目')));

      if (item.name && item.slug) {
        const a = el('a', 'proj-name-link');
        a.href = '/p/' + encodeURIComponent(item.slug);
        a.appendChild(el('h3', 'proj-name', item.name));
        card.appendChild(a);
      } else if (item.name) {
        card.appendChild(el('h3', 'proj-name', item.name));
      }

      // 完整网址直接展示在标题下（需求 3；空则不渲染）
      const url = (item.link || '').trim();
      if (url) {
        const a = el('a', 'proj-url', url);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        card.appendChild(a);
      }

      if (item.stack) card.appendChild(el('p', 'proj-stack', item.stack));
      if (item.period) card.appendChild(el('p', 'proj-period', item.period));

      renderThumb(card, item.image, item.imageWidth, item.name);

      fillBullets(card, item.bullets);

      if (item.slug) {
        const a = el('a', 'proj-detail-btn', '点击查看详情页');
        a.href = '/p/' + encodeURIComponent(item.slug);
        card.appendChild(a);
      }
      if (item.link) {
        const a = el('a', 'proj-link-btn', '项目链接');
        a.href = item.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        card.appendChild(a);
      }
      grid.appendChild(card);
    });
    watchReveals(grid);
  }

  const fillBullets = (box, bullets) => {
    const list = (Array.isArray(bullets) ? bullets : []).filter(Boolean);
    if (!list.length) return;
    const ul = el('ul', 'bullets');
    list.forEach((b) => ul.appendChild(el('li', null, b)));
    box.appendChild(ul);
  };

  function renderProgress(list) {
    const box = body('progress');
    box.textContent = '';
    if (!list.length) return emptyNote(box);
    const table = el('div', 'prog-table');
    const cols = el('div', 'prog-row prog-cols');
    ['项目', '状态', '说明'].forEach((t) => cols.appendChild(el('span', null, t)));
    table.appendChild(cols);
    list.forEach((it) => {
      const row = el('div', 'prog-row');
      row.appendChild(el('p', 'prog-project', it.project));
      row.appendChild(el('p', 'prog-status', it.status));
      row.appendChild(el('p', 'prog-note', it.note));
      table.appendChild(row);
    });
    box.appendChild(table);
  }

  function renderCampus(list) {
    const box = body('campus');
    box.textContent = '';
    if (!list.length) {
      box.appendChild(el('p', 'campus-empty', '这一栏还没写好——校园经历整理好后会在后台补上。'));
      return;
    }
    const wrap = el('div', 'campus-list');
    list.forEach((it) => {
      const row = el('div', 'campus-row');
      row.appendChild(el('p', 'campus-period', it.period));
      const main = el('div', 'campus-main');
      main.appendChild(el('p', 'campus-title', it.title));
      if (it.org) main.appendChild(el('p', 'campus-org', it.org));
      if (it.detail) main.appendChild(el('p', 'campus-detail', it.detail));
      row.appendChild(main);
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }

  function renderHonors(list) {
    const box = body('honors');
    box.textContent = '';
    if (!list.length) return emptyNote(box);
    const wrap = el('div', 'honor-list');
    list.forEach((it) => {
      const item = el('div', 'honor-item');
      const row = el('div', 'honor-row');
      row.appendChild(el('p', 'honor-year', it.year));
      row.appendChild(el('p', 'honor-name', it.name));
      row.appendChild(el('p', 'honor-detail', it.detail));
      item.appendChild(row);
      renderThumb(item, it.image, it.imageWidth, it.name);
      wrap.appendChild(item);
    });
    box.appendChild(wrap);
  }

  function renderModule(mod, idx) {
    const node = el('div', 'module');
    const toggle = el('button', 'module-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const bodyId = 'intern-module-' + idx;
    toggle.setAttribute('aria-controls', bodyId);

    const head = el('span', 'module-head');
    head.appendChild(el('span', 'module-title', mod.title));
    head.appendChild(el('span', 'module-summary', mod.summary));
    toggle.appendChild(head);
    const cue = el('span', 'module-cue', '点击查看详情');
    toggle.appendChild(cue);

    const bodyEl = el('div', 'module-body');
    bodyEl.id = bodyId;
    const inner = el('div', 'module-body-inner');
    const ul = el('ul', 'bullets');
    (Array.isArray(mod.bullets) ? mod.bullets.filter(Boolean) : []).forEach((b) => ul.appendChild(el('li', null, b)));
    inner.appendChild(ul);
    bodyEl.appendChild(inner);

    toggle.addEventListener('click', () => {
      const expanded = node.classList.toggle('expanded');
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      cue.textContent = expanded ? '收起' : '点击查看详情';
    });

    node.appendChild(toggle);
    node.appendChild(bodyEl);
    return node;
  }

  function renderInternship(list) {
    const box = body('internship');
    box.textContent = '';
    if (!list.length) return emptyNote(box);
    list.forEach((it) => {
      const art = el('article', 'intern');
      const head = el('header', 'intern-head');
      head.appendChild(el('h3', 'intern-company', it.company));
      if (it.period) head.appendChild(el('p', 'intern-period', it.period));
      art.appendChild(head);
      if (it.role) art.appendChild(el('p', 'intern-role', it.role));
      if (it.dept) art.appendChild(el('p', 'intern-dept', it.dept));
      fillBullets(art, it.bullets);

      const modules = (Array.isArray(it.modules) ? it.modules : []).filter(Boolean);
      if (modules.length) {
        art.appendChild(el('p', 'block-label', '实习模块'));
        const wrap = el('div', 'module-list');
        modules.forEach((mod, i) => wrap.appendChild(renderModule(mod, i)));
        art.appendChild(wrap);
      }

      if (it.takeaway) {
        const tw = el('div', 'takeaway');
        tw.appendChild(el('p', 'block-label', '实习收获'));
        tw.appendChild(el('p', 'takeaway-text', it.takeaway));
        art.appendChild(tw);
      }

      renderThumb(art, it.image, it.imageWidth, it.company);
      box.appendChild(art);
    });
  }

  // AI 快捷问题（v2 ⑦ C7）：seed/API 驱动；无下发时保留 HTML 静态默认（零 JS 兜底）
  function renderQuickQuestions(data) {
    const list = Array.isArray(data && data.quickQuestions) && data.quickQuestions.length ? data.quickQuestions : null;
    if (!list) return;
    ['#qa-suggest', '#chat-suggest'].forEach((sel) => {
      const box = $(sel);
      if (!box) return;
      box.textContent = '';
      list.forEach((q) => {
        const btn = el('button', '', q);
        btn.type = 'button';
        btn.dataset.q = q;
        box.appendChild(btn);
      });
    });
  }

  async function loadContent() {
    try {
      const res = await fetch(API_BASE + '/api/content', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      renderHero(data.profile || {});
      renderHomeAbout(data.profile || {});
      renderProjectsHome(data.projects || []);
      renderQuickQuestions(data);
      renderHomeIndex(data);
      renderOverview(data);
      renderProjects(data.projects || []);
      renderProgress(data.progress || []);
      renderCampus(data.campus || []);
      renderHonors(data.honors || []);
      renderInternship(data.internship || []);
      const mail = $('#foot-email');
      if (data.profile && data.profile.email) {
        mail.textContent = data.profile.email;
        mail.href = 'mailto:' + data.profile.email;
        mail.hidden = false;
      }
      watchReveals(document);
    } catch (err) {
      $('#load-error').hidden = false;
    }
  }

  /* ---------- 对话：POST /api/chat，SSE 流式（与旧版一致，共用实现） ---------- */
  const scrollMsgs = (ctx) => { ctx.msgs.scrollTop = ctx.msgs.scrollHeight; };

  // 轻量 Markdown 渲染（AI 回答用）：转义优先，支持 段落/无序·有序列表/标题/引用/粗体/斜体/行内代码。
  // 不引入依赖（站点零 CDN 约束）；先整体转义再拼标签，杜绝注入。
  function renderMd(text) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s) => esc(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let list = null;
    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const raw of lines) {
      const ul = raw.match(/^\s*[-*•]\s+(.*)$/);
      const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const tag = ul ? 'ul' : 'ol';
        if (list !== tag) { closeList(); html += '<' + tag + ' class="md-list">'; list = tag; }
        html += '<li>' + inline((ul || ol)[1]) + '</li>';
        continue;
      }
      closeList();
      const h = raw.match(/^\s*#{1,6}\s+(.*)$/);
      if (h) { html += '<p class="md-h">' + inline(h[1]) + '</p>'; continue; }
      const q = raw.match(/^\s*>\s?(.*)$/);
      if (q) { html += '<p class="md-quote">' + inline(q[1]) + '</p>'; continue; }
      if (!raw.trim()) continue; // 空行仅作分段，段落间距由 CSS 控制
      html += '<p>' + inline(raw) + '</p>';
    }
    closeList();
    return html;
  }

  function addMsg(ctx, role, text, cls) {
    const wrap = el('div', 'chat-msg ' + (cls || role));
    if (role) wrap.appendChild(el('p', 'who', role === 'user' ? '你' : 'AI'));
    const textEl = el('p', 'text');
    if (role === 'assistant' && text) textEl.innerHTML = renderMd(text);
    else textEl.textContent = text || '';
    wrap.appendChild(textEl);
    ctx.msgs.appendChild(wrap);
    scrollMsgs(ctx);
    return textEl;
  }

  function finishExchange(ctx, question, answer, ok) {
    if (ok && answer) {
      ctx.history.push({ role: 'user', content: question });
      ctx.history.push({ role: 'assistant', content: answer });
      ctx.history = ctx.history.slice(-12);
    }
  }

  async function sendChat(ctx, message) {
    const text = (message || '').trim();
    if (!text) return;
    if (ctx.controller) ctx.controller.abort();

    if (ctx.suggest) ctx.suggest.hidden = true;
    if (ctx.flow) ctx.flow.hidden = false;
    addMsg(ctx, 'user', text, 'user');
    ctx.input.value = '';
    if (ctx.sendBtn) ctx.sendBtn.disabled = true;

    const target = addMsg(ctx, 'assistant', '', 'assistant');
    const controller = new AbortController();
    ctx.controller = controller;

    let full = '';
    let ok = true;
    let errorShown = false;

    const handleFrame = (frame) => {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let obj = null;
        try { obj = JSON.parse(payload); } catch (e) { continue; }
        if (obj && obj.error) throw new Error(obj.error);
        if (obj && typeof obj.delta === 'string' && obj.delta) {
          full += obj.delta;
          target.innerHTML = renderMd(full);
          scrollMsgs(ctx);
        }
      }
    };

    try {
      const res = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: ctx.history.slice(-12) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let msg = '请求失败（' + res.status + '），请稍后再试。';
        try {
          const j = await res.json();
          if (j && j.error) msg = j.error;
        } catch (e) { /* 用默认提示 */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          handleFrame(buf.slice(0, i));
          buf = buf.slice(i + 2);
        }
      }
      buf += decoder.decode();
      if (buf.trim()) handleFrame(buf);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // 用户主动停止：保留已收到的部分
      } else {
        ok = false;
        const note = err && err.message ? err.message : '网络异常，请稍后再试。';
        if (full) {
          target.textContent = full + '\n\n（回答中断：' + note + '）';
        } else {
          target.textContent = '出错了 — ' + note;
          target.parentNode.classList.add('error');
          errorShown = true;
        }
      }
    } finally {
      if (ctx.controller === controller) ctx.controller = null;
      if (ctx.sendBtn) ctx.sendBtn.disabled = false;
      if (!full && !errorShown) {
        const bubble = target.parentNode;
        if (bubble && bubble.classList.contains('assistant')) bubble.parentNode.removeChild(bubble);
      }
      finishExchange(ctx, text, full, ok);
      ctx.input.focus();
      scrollMsgs(ctx);
    }
  }

  function createChatUI(opts) {
    const ctx = Object.assign({ history: [], controller: null }, opts);
    if (ctx.suggest) {
      ctx.suggest.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-q]');
        if (btn) sendChat(ctx, btn.getAttribute('data-q'));
      });
    }
    if (ctx.form) {
      ctx.form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendChat(ctx, ctx.input.value);
      });
    }
    return ctx;
  }

  function initChats() {
    createChatUI({
      msgs: $('#qa-msgs'), suggest: $('#qa-suggest'),
      form: $('#qa-form'), input: $('#qa-input'),
      sendBtn: $('#qa-send'), flow: $('#qa-flow'),
    });

    const panel = createChatUI({
      msgs: $('#chat-msgs'), suggest: $('#chat-suggest'),
      form: $('#chat-form'), input: $('#chat-input'),
      sendBtn: $('#chat-send'), flow: null,
    });

    const pnl = $('#chat-panel');
    const fab = $('#ask-open-fab');
    let pnlCloseTimer = 0;
    let fabHideTimer = 0;

    const open = () => {
      if (pnlCloseTimer) { clearTimeout(pnlCloseTimer); pnlCloseTimer = 0; }
      if (fabHideTimer) { clearTimeout(fabHideTimer); fabHideTimer = 0; }
      // v2 ⑤：进场 240ms —— 先显示再补 .open 触发 transition
      pnl.hidden = false;
      pnl.classList.remove('open');
      void pnl.offsetWidth;
      pnl.classList.add('open');
      if (fab && !fab.hidden) {
        // FAB 同步 150ms 淡出后隐藏
        fab.classList.add('fab-hide');
        fabHideTimer = setTimeout(() => { fab.hidden = true; fabHideTimer = 0; }, 150);
      } else if (fab) {
        fab.hidden = true;
      }
      panel.input.focus();
    };

    const close = () => {
      if (pnlCloseTimer) return; // 防重复关闭（关闭键 + ESC 连发）
      if (reducedMotion()) {
        pnl.classList.remove('open');
        pnl.hidden = true;
        pnlCloseTimer = 0;
        updateFab();
        if (panel.controller) panel.controller.abort();
        return;
      }
      // v2 ⑤：退场 150ms 后才真正隐藏
      pnl.classList.remove('open');
      pnlCloseTimer = setTimeout(() => {
        pnlCloseTimer = 0;
        pnl.hidden = true;
        updateFab();
      }, 150);
      if (panel.controller) panel.controller.abort();
    };

    fab.addEventListener('click', open);
    $('#chat-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pnl.hidden) close();
    });
  }

  /* ---------- 启动 ---------- */
  initChats();
  initRouter();
  initHeroParallax();
  initDots();
  initSigPatterns();
  loadContent();
})();
