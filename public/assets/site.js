/* 陆耀威个人站 · 访客端脚本
   内容一律来自 GET /api/content 动态渲染，对话走 POST /api/chat（SSE 流式）。
   字段名以 docs/API_CONTRACT.md 为准：profile / projects / progress /
   campus / honors / internship，不得擅改。 */
(() => {
  'use strict';

  // 接口基址：默认同源；联调/自测可用 ?api=http://host:port 覆盖。
  const API_BASE = new URLSearchParams(location.search).get('api') || '';

  const $ = (sel) => document.querySelector(sel);

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  };

  const body = (name) => document.querySelector('[data-body="' + name + '"]');

  // 有值才写入，避免空数据清掉骨架
  const fill = (node, text) => {
    if (node && text !== undefined && text !== null && text !== '') node.textContent = text;
  };

  const emptyNote = (box) => box.appendChild(el('p', 'empty-note', '这一栏暂时没有内容。'));

  // 两大旗舰项目：projects 列表 id → 详情页 slug（详情内容由公开接口 GET /api/project/:slug 提供，不在前端硬编码）。
  // 其余三个 STM32 项目保持卡片式，不进入此映射。
  const PROJECT_DETAIL_SLUGS = { 1: 'eda-agent-bridge', 2: 'wei-plus' };

  const fillBullets = (box, bullets) => {
    const list = (Array.isArray(bullets) ? bullets : []).filter(Boolean);
    if (!list.length) return;
    const ul = el('ul', 'bullets');
    list.forEach((b) => ul.appendChild(el('li', null, b)));
    box.appendChild(ul);
  };

  /* ---------- 图片：缩略图 + 全屏放大浮层（无图条目不渲染节点） ---------- */

  const lb = { root: null, img: null, open: false };

  function ensureLightbox() {
    if (lb.root) return;
    const root = el('div', 'lightbox');
    const img = el('img', 'lightbox-img');
    img.alt = '';
    const close = el('button', 'lightbox-close', '关闭');
    close.type = 'button';
    root.appendChild(img);
    root.appendChild(close);
    root.addEventListener('click', (e) => {
      if (e.target === root) closeLightbox(); // 点遮罩（非图片）关闭
    });
    close.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lb.open) closeLightbox();
    });
    document.body.appendChild(root);
    lb.root = root;
    lb.img = img;
  }

  function openLightbox(src) {
    ensureLightbox();
    lb.img.src = src;
    lb.open = true;
    lb.root.classList.add('show');
  }

  function closeLightbox() {
    if (!lb.root) return;
    lb.open = false;
    lb.root.classList.remove('show');
  }

  function renderThumb(box, image, imageWidth, alt) {
    const url = (image || '').trim();
    if (!url) return; // 旧数据可能没有 image 字段，完全跳过
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

  /* ---------- 六类内容渲染 ---------- */

  function renderProfile(p) {
    fill($('#intro-name'), p.name);
    fill($('#intro-intent'), p.intent);
    // 元信息行：邮箱 / 所在地 / 政治面貌（等宽字体），有值才显示
    $('#intro-meta').textContent = [p.email, p.location, p.politics].filter(Boolean).join(' / ');

    const box = body('profile');
    box.textContent = '';

    // 个人简介：下移到「01 个人介绍」展示节首块（AI 首屏面板下方）
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

  function renderProjects(list) {
    const box = body('projects');
    box.textContent = '';
    if (!list.length) return emptyNote(box);
    list.forEach((item, i) => {
      const art = el('article', 'project');
      const head = el('header', 'proj-head');
      head.appendChild(el('p', 'proj-no', '02.' + (i + 1)));
      if (item.name) head.appendChild(el('h3', 'proj-name', item.name));
      if (item.tag) head.appendChild(el('p', 'proj-tag', item.tag));
      art.appendChild(head);
      if (item.stack) art.appendChild(el('p', 'proj-stack', item.stack));
      // 契约：period / link 为空串时不渲染
      if (item.period) art.appendChild(el('p', 'proj-period', item.period));
      if (item.link) {
        const a = el('a', 'proj-link', '项目链接');
        a.href = item.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        art.appendChild(a);
      }
      renderThumb(art, item.image, item.imageWidth, item.name); // 要点列表之前
      fillBullets(art, item.bullets);
      // 旗舰项目「查看详情」入口（其余 STM32 项目无详情页，不出此链接）
      const detailSlug = PROJECT_DETAIL_SLUGS[item.id];
      if (detailSlug) {
        const a = el('a', 'proj-detail', '查看详情');
        a.href = '/p/' + detailSlug;
        art.appendChild(a);
      }
      box.appendChild(art);
    });
  }

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
    // 契约：campus 初始为空数组，须优雅展示「待补充」，不得报错、不得留空白节
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
      renderThumb(item, it.image, it.imageWidth, it.name); // 条目信息之后
      wrap.appendChild(item);
    });
    box.appendChild(wrap);
  }

  // 实习子模块：标题+摘要 行 + 展开/收起要点列表（键盘可操作、aria-expanded）
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
      // 顶层概览要点（bullets）保留，与子模块并存
      fillBullets(art, it.bullets);

      // 子模块：每模块「标题+摘要」行 + 展开要点；旧数据无 modules 时回退（仅顶层 bullets，已渲染，不再额外产出）
      const modules = (Array.isArray(it.modules) ? it.modules : []).filter(Boolean);
      if (modules.length) {
        art.appendChild(el('p', 'block-label', '实习模块'));
        const wrap = el('div', 'module-list');
        modules.forEach((mod, i) => wrap.appendChild(renderModule(mod, i)));
        art.appendChild(wrap);
      }

      // 实习收获
      if (it.takeaway) {
        const tw = el('div', 'takeaway');
        tw.appendChild(el('p', 'block-label', '实习收获'));
        tw.appendChild(el('p', 'takeaway-text', it.takeaway));
        art.appendChild(tw);
      }

      renderThumb(art, it.image, it.imageWidth, it.company); // 条目信息之后
      box.appendChild(art);
    });
  }

  async function loadContent() {
    try {
      const res = await fetch(API_BASE + '/api/content', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      renderProfile(data.profile || {});
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
    } catch (err) {
      $('#load-error').hidden = false;
    }
  }

  /* ---------- 顶部目录：当前节高亮 ---------- */

  function initToc() {
    const links = Array.from(document.querySelectorAll('.toc a'));
    const sections = links
      .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
      .filter(Boolean);
    if (!sections.length) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      let currentId = sections[0].id;
      for (const sec of sections) {
        if (sec.getBoundingClientRect().top <= 120) currentId = sec.id;
      }
      // 页面滚到底时强制命中最后一节
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        currentId = sections[sections.length - 1].id;
      }
      links.forEach((a) => {
        a.classList.toggle('current', a.getAttribute('href') === '#' + currentId);
      });
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ---------- 对话：POST /api/chat，SSE 流式 ----------
     中央问答区与右下角浮层各自持一份 history/controller，
     但消息渲染、流式解析、错误处理都走下面这套共用实现，不得复制。 */

  const scrollMsgs = (ctx) => { ctx.msgs.scrollTop = ctx.msgs.scrollHeight; };

  function addMsg(ctx, role, text, cls) {
    const wrap = el('div', 'chat-msg ' + (cls || role));
    if (role) wrap.appendChild(el('p', 'who', role === 'user' ? '你' : 'AI'));
    const textEl = el('p', 'text', text || '');
    wrap.appendChild(textEl);
    ctx.msgs.appendChild(wrap);
    scrollMsgs(ctx);
    return textEl;
  }

  function finishExchange(ctx, question, answer, ok) {
    if (ok && answer) {
      ctx.history.push({ role: 'user', content: question });
      ctx.history.push({ role: 'assistant', content: answer });
      ctx.history = ctx.history.slice(-12); // 契约：history 只保留最近 12 条
    }
  }

  async function sendChat(ctx, message) {
    const text = (message || '').trim();
    if (!text) return;
    if (ctx.controller) ctx.controller.abort(); // 同一实例同一时刻只保留一条流

    if (ctx.suggest) ctx.suggest.hidden = true;
    if (ctx.flow) ctx.flow.hidden = false; // 中央区：对话流就地展开
    addMsg(ctx, 'user', text, 'user');
    ctx.input.value = '';
    if (ctx.sendBtn) ctx.sendBtn.disabled = true;

    const target = addMsg(ctx, 'assistant', '', 'assistant');
    const controller = new AbortController();
    ctx.controller = controller;

    let full = '';
    let ok = true;
    let errorShown = false; // catch 已把错误提示写进气泡时，禁止 finally 清理

    // 解析一个 SSE 帧（data: 行），增量写入 target
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
          target.textContent = full; // textContent 追加，天然免 XSS
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
        // 限流 429 等返回 JSON：优先展示服务端 error 字段
        let msg = '请求失败（' + res.status + '），请稍后再试。';
        try {
          const j = await res.json();
          if (j && j.error) msg = j.error;
        } catch (e) { /* 非 JSON 响应，用默认提示 */ }
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
      buf += decoder.decode(); // 冲洗解码器尾字节
      if (buf.trim()) handleFrame(buf); // 服务端漏发结尾空行时的兜底
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // 用户主动停止（关面板/发新问题）：保留已收到的部分
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
        // 空气泡（零字节流 / 主动中断）直接移除，不留空白消息
        const bubble = target.parentNode;
        if (bubble && bubble.classList.contains('assistant')) bubble.parentNode.removeChild(bubble);
      }
      finishExchange(ctx, text, full, ok);
      ctx.input.focus(); // 发送后保持焦点在输入框
      scrollMsgs(ctx);
    }
  }

  // 创建一个聊天 UI 实例：绑定消息区/快捷问题/表单，独立 history 与 controller
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
    // 中央问答区（开篇内、就地展开）：无发送按钮，回车或快捷问题触发
    createChatUI({
      msgs: $('#qa-msgs'), suggest: $('#qa-suggest'),
      form: $('#qa-form'), input: $('#qa-input'),
      sendBtn: null, flow: $('#qa-flow'),
    });

    // 右下角浮层（原交互不变）
    const panel = createChatUI({
      msgs: $('#chat-msgs'), suggest: $('#chat-suggest'),
      form: $('#chat-form'), input: $('#chat-input'),
      sendBtn: $('#chat-send'), flow: null,
    });

    const pnl = $('#chat-panel');
    const fab = $('#ask-open-fab');
    const open = () => {
      pnl.hidden = false;
      fab.hidden = true;
      panel.input.focus();
    };
    const close = () => {
      pnl.hidden = true;
      fab.hidden = false;
      if (panel.controller) panel.controller.abort();
    };

    $('#ask-open-head').addEventListener('click', open);
    fab.addEventListener('click', open);
    $('#chat-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pnl.hidden) close();
    });
  }

  /* ---------- 启动 ---------- */

  initToc();
  initChats();
  loadContent();
})();
