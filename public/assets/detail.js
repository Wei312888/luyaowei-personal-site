/* 陆耀威个人站 · 项目深度详情页(/p/:slug)「蓝图档案」版
   内容来自 GET /api/project/:slug 按 slug 渲染 projectDocs；skeleton 为骨架态。
   字段名以 docs/API_CONTRACT.md 为准：slug / name / tagline / stack / summary /
   diagram / architecture / mcpTools / httpEndpoints / challenges / results /
   bullets / link / skeleton。
   报告型可选字段（v2 ⑦，全可选，AI 项目不设即自动走 AI 型 6 章模板）：
   contest / roleNote / period / metrics[{item,value,note,source}] /
   theory[{title,detail}] / tests[{title,items[]}] / lessons[] / sources[{label,type,note}] */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  };

  // 从 /p/:slug 提取 slug
  const match = location.pathname.match(/^\/p\/([^/]+)\/?$/);
  const slug = match ? decodeURIComponent(match[1]) : '';

  const show = (node) => { node.hidden = false; };
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = () => window.matchMedia('(pointer: fine)').matches;

  const setMeta = (attr, name, value) => {
    const m = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (m) m.setAttribute('content', value);
  };

  /* ---------- 章节模型：AI 型 6 章（现有字段）/ 报告型 7 章（报告字段，按存在性选择） ----------
     静态 HTML 已含全部编号节；渲染层按模板重写节头编号/EN/中文标题，
     空章节保持 hidden，章节树只列可见节。 */
  const AI_TEMPLATE = [
    { id: 'sec-arch',       no: '01', en: 'ARCHITECTURE', head: '架构链路',     tree: '架构链路' },
    { id: 'sec-mcp',        no: '02', en: 'MCP TOOLS',    head: 'MCP 工具清单', tree: 'MCP 工具' },
    { id: 'sec-http',       no: '03', en: 'HTTP API',     head: 'HTTP 接口',    tree: 'HTTP 接口' },
    { id: 'sec-challenges', no: '04', en: 'CHALLENGES',   head: '关键难点与方案', tree: '关键难点' },
    { id: 'sec-results',    no: '05', en: 'RESULTS',      head: '量化成果',     tree: '量化成果' },
    { id: 'sec-link',       no: '06', en: 'LINK',         head: '开源 / 演示',  tree: '开源 / 演示' }
  ];
  const REPORT_TEMPLATE = [
    { id: 'sec-arch',       no: '01', en: 'SYSTEM LINK',  head: '系统链路',     tree: '系统链路' },
    { id: 'sec-theory',     no: '02', en: 'THEORY',       head: '核心算法与理论', tree: '核心算法与理论' },
    { id: 'sec-metrics',    no: '03', en: 'METRICS',      head: '关键指标',     tree: '关键指标' },
    { id: 'sec-challenges', no: '04', en: 'CHALLENGES',   head: '关键难点与方案', tree: '关键难点' },
    { id: 'sec-tests',      no: '05', en: 'TESTS',        head: '测试与实测',   tree: '测试与实测' },
    { id: 'sec-lessons',    no: '06', en: 'LESSONS',      head: '复盘与收获',   tree: '复盘与收获' },
    { id: 'sec-sources',    no: '07', en: 'SOURCES',      head: '资料',         tree: '资料' }
  ];
  const SOURCE_LABEL = { report: '技术报告', site: '站点口径', raw: '实测记录' };

  // 报告型判定：出现任一报告字段即走 7 章模板（AI 项目文档不含这些字段 → 保持 6 章）
  function isReportDoc(doc) {
    return Boolean(
      doc.contest || doc.roleNote ||
      (Array.isArray(doc.metrics) && doc.metrics.length) ||
      (Array.isArray(doc.theory) && doc.theory.length) ||
      (Array.isArray(doc.tests) && doc.tests.length) ||
      (Array.isArray(doc.lessons) && doc.lessons.length) ||
      (Array.isArray(doc.sources) && doc.sources.length)
    );
  }

  // 按模板重写各节头（编号 + 英文副题 + 中文标题）
  function applyTemplate(template) {
    template.forEach((sec) => {
      const node = document.getElementById(sec.id);
      if (!node) return;
      const no = node.querySelector('.sec-no');
      if (no) {
        no.textContent = '';
        const span = document.createElement('span');
        span.className = 'no';
        span.textContent = sec.no;
        no.appendChild(span);
        no.appendChild(document.createTextNode(' / ' + sec.en));
      }
      const h2 = node.querySelector('h2');
      if (h2) h2.textContent = sec.head;
    });
  }

  /* ---------- 章节树：由可见章节生成节点；点击节点滚动/高亮对应节 ---------- */
  function renderTree(template) {
    const visible = template.filter((sec) => {
      const n = document.getElementById(sec.id);
      return n && !n.hidden;
    });
    const tree = $('#doc-tree');
    tree.textContent = '';
    if (!visible.length) { tree.hidden = true; return; }
    tree.hidden = false;
    const branch = el('div', 'tree-branch');
    visible.forEach((sec) => {
      const btn = el('button', 'tree-node');
      btn.type = 'button';
      btn.dataset.target = sec.id;
      btn.appendChild(el('span', 'tn-no', sec.no));
      btn.appendChild(document.createTextNode(sec.tree));
      btn.addEventListener('click', () => {
        $$('.tree-node').forEach((n) => n.classList.remove('current'));
        btn.classList.add('current');
        const target = document.getElementById(sec.id);
        if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 76, behavior: 'smooth' });
      });
      branch.appendChild(btn);
    });
    tree.appendChild(branch);
    // 进场（允许清单 4，一次）：节点依次点亮；任一时序都保证节点可见——
    // 末节点 ≤300ms 触发 + 0.3s 过渡 ≤600ms 完成；600ms 硬兜底全亮；reduced-motion 即时全亮
    const nodes = Array.from(tree.querySelectorAll('.tree-node'));
    if (reducedMotion()) {
      nodes.forEach((n) => n.classList.add('lit'));
    } else {
      nodes.forEach((n, i) => {
        if (i === 0) n.classList.add('lit'); // 首节点立即可见
        else setTimeout(() => n.classList.add('lit'), 60 * i); // 60ms 步进（60…300ms）
      });
      setTimeout(() => nodes.forEach((n) => n.classList.add('lit')), 600);
    }
  }

  /* ---------- 渲染工具/接口清单（AI 型） ---------- */
  function renderTools(ul, list, kind) {
    (Array.isArray(list) ? list : []).filter(Boolean).forEach((it) => {
      const li = el('li');
      const name = el('p', 'tool-name', kind === 'http' ? (it.method + ' ' + it.path) : it.name);
      li.appendChild(name);
      if (kind === 'http') {
        const meta = el('p', 'tool-meta', it.method);
        li.appendChild(meta);
      }
      if (it.description) li.appendChild(el('p', 'tool-desc', it.description));
      else if (it.purpose) li.appendChild(el('p', 'tool-desc', it.purpose));
      ul.appendChild(li);
    });
  }

  /* ---------- 报告型章节渲染器 ---------- */

  // 02 核心算法与理论（title/detail 或纯字符串条目）
  function renderTheory(list) {
    const dl = $('#theory-list');
    dl.textContent = '';
    (Array.isArray(list) ? list : []).filter(Boolean).forEach((it) => {
      const item = el('div', 'challenge-item');
      if (typeof it === 'string') {
        item.appendChild(el('dd', null, it));
      } else {
        if (it.title) item.appendChild(el('dt', null, it.title));
        item.appendChild(el('dd', null, it.detail || ''));
      }
      dl.appendChild(item);
    });
    if (dl.children.length) show($('#sec-theory'));
  }

  // 03 关键指标：表格式网格（指标项 / 口径值 / 说明 / 来源）
  function renderMetrics(list) {
    const box = $('#metrics-list');
    box.textContent = '';
    const head = el('div', 'm-row m-head');
    head.appendChild(el('span', 'm-item', '指标项'));
    head.appendChild(el('span', 'm-value', '口径值'));
    head.appendChild(el('span', 'm-note', '说明 / 实测记录'));
    head.appendChild(el('span', 'm-src', '来源'));
    box.appendChild(head);
    (Array.isArray(list) ? list : []).filter(Boolean).forEach((m) => {
      const row = el('div', 'm-row');
      row.appendChild(el('span', 'm-item', m.item || ''));
      row.appendChild(el('span', 'm-value', m.value || ''));
      row.appendChild(el('span', 'm-note', m.note || ''));
      const src = el('span', 'm-src', SOURCE_LABEL[m.source] || m.source || '');
      row.appendChild(src);
      box.appendChild(row);
    });
    if (box.children.length > 1) show($('#sec-metrics'));
  }

  // 05 测试与实测：分组块（组标题 + 行条目）
  function renderTests(list) {
    const box = $('#tests-list');
    box.textContent = '';
    (Array.isArray(list) ? list : []).filter(Boolean).forEach((t) => {
      const block = el('div', 'test-block');
      if (t.title) block.appendChild(el('p', 'test-title', t.title));
      const items = Array.isArray(t.items) ? t.items.filter(Boolean) : [];
      if (items.length) {
        const ul = el('ul', 'bullets');
        items.forEach((s) => ul.appendChild(el('li', null, s)));
        block.appendChild(ul);
      }
      box.appendChild(block);
    });
    if (box.children.length) show($('#sec-tests'));
  }

  // 06 复盘与收获
  function renderLessons(list) {
    const ul = $('#lessons-list');
    (Array.isArray(list) ? list : []).filter(Boolean).forEach((s) => ul.appendChild(el('li', null, s)));
    if (ul.children.length) show($('#sec-lessons'));
  }

  // 07 资料（label + type 标签 + note）
  function renderSources(list) {
    const ul = $('#sources-list');
    (Array.isArray(list) ? list : []).filter(Boolean).forEach((s) => {
      const li = el('li', 'source-item');
      const label = el('p', 'source-label', s.label || '');
      li.appendChild(label);
      if (s.type) li.appendChild(el('span', 'source-type', SOURCE_LABEL[s.type] || s.type));
      if (s.note) li.appendChild(el('p', 'source-note', s.note));
      ul.appendChild(li);
    });
    if (ul.children.length) show($('#sec-sources'));
  }

  function renderDoc(doc) {
    document.title = doc.name + ' · 陆耀威';

    // 独立 og:title / og:description / og:url（项目名）
    const pgUrl = location.origin + '/p/' + encodeURIComponent(doc.slug);
    setMeta('property', 'og:title', doc.name + ' · 陆耀威');
    setMeta('property', 'og:description', doc.tagline || doc.summary || '');
    setMeta('property', 'og:url', pgUrl);
    setMeta('name', 'description', doc.tagline || doc.summary || '');
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.href = pgUrl;

    $('body').dataset.slug = doc.slug;
    $('#doc-slug').textContent = doc.slug;
    $('#doc-name').textContent = doc.name || '';
    $('#doc-tagline').textContent = doc.tagline || '';
    $('#doc-stack').textContent = doc.stack || '';
    $('#doc-summary').textContent = doc.summary || '';

    // 报告型附加元信息行：时间 / 赛题口径 / 分工（全可选）
    const metaParts = [];
    if (doc.period) metaParts.push('时间：' + doc.period);
    if (doc.contest) metaParts.push('赛题：' + doc.contest);
    if (doc.roleNote) metaParts.push('分工：' + doc.roleNote);
    if (metaParts.length) {
      const metaP = $('#doc-meta');
      metaP.textContent = metaParts.join(' · ');
      show(metaP);
    }

    const report = isReportDoc(doc);
    const template = report ? REPORT_TEMPLATE : AI_TEMPLATE;
    applyTemplate(template);

    // 骨架态：显示印戳与说明，不编造成果（AI 型模板渲染要点列表）
    if (doc.skeleton) {
      $('#doc-skeleton-mark').hidden = false;
      $('#doc-skeleton-note').hidden = false;
      const ul = $('#result-list');
      (Array.isArray(doc.bullets) ? doc.bullets.filter(Boolean) : []).forEach((b) => ul.appendChild(el('li', null, b)));
      if (ul.children.length) show($('#sec-results'));
    }

    // 01 系统链路 / 架构链路（两模板共用）
    const archList = $('#arch-list');
    (Array.isArray(doc.architecture) ? doc.architecture : []).filter(Boolean).forEach((a) => {
      const li = el('li');
      li.appendChild(el('strong', null, a.label));
      if (a.detail) li.appendChild(document.createTextNode(' — ' + a.detail));
      archList.appendChild(li);
    });
    if (doc.diagram) {
      const img = $('#diagram');
      img.src = doc.diagram;
      img.alt = doc.name + ' · 架构链路图';
      show($('#diagram-wrap'));
    }
    if (doc.diagram || archList.children.length) show($('#sec-arch'));

    if (report) {
      // 02 核心算法与理论
      if (Array.isArray(doc.theory) && doc.theory.length) renderTheory(doc.theory);
      // 03 关键指标
      if (Array.isArray(doc.metrics) && doc.metrics.length) renderMetrics(doc.metrics);
      // 04 关键难点（共用）
      if (Array.isArray(doc.challenges) && doc.challenges.length) {
        const dl = $('#challenge-list');
        doc.challenges.filter(Boolean).forEach((c) => {
          const item = el('div', 'challenge-item');
          item.appendChild(el('dt', null, c.title));
          item.appendChild(el('dd', null, c.solution));
          dl.appendChild(item);
        });
        show($('#sec-challenges'));
      }
      // 05 测试与实测
      if (Array.isArray(doc.tests) && doc.tests.length) renderTests(doc.tests);
      // 06 复盘与收获
      if (Array.isArray(doc.lessons) && doc.lessons.length) renderLessons(doc.lessons);
      // 07 资料
      if (Array.isArray(doc.sources) && doc.sources.length) renderSources(doc.sources);
    } else {
      // AI 型：02 MCP / 03 HTTP / 04 关键难点 / 05 量化成果 / 06 链接
      if (Array.isArray(doc.mcpTools) && doc.mcpTools.length) {
        renderTools($('#mcp-list'), doc.mcpTools, 'mcp');
        show($('#sec-mcp'));
      }
      if (Array.isArray(doc.httpEndpoints) && doc.httpEndpoints.length) {
        renderTools($('#http-list'), doc.httpEndpoints, 'http');
        show($('#sec-http'));
      }
      if (Array.isArray(doc.challenges) && doc.challenges.length) {
        const dl = $('#challenge-list');
        doc.challenges.filter(Boolean).forEach((c) => {
          const item = el('div', 'challenge-item');
          item.appendChild(el('dt', null, c.title));
          item.appendChild(el('dd', null, c.solution));
          dl.appendChild(item);
        });
        show($('#sec-challenges'));
      }
      if (!doc.skeleton && Array.isArray(doc.results) && doc.results.length) {
        const ul = $('#result-list');
        doc.results.forEach((r) => ul.appendChild(el('li', null, r)));
        show($('#sec-results'));
      }
      if (doc.link) {
        const a = $('#link-a');
        a.href = doc.link;
        a.textContent = doc.link;
        show($('#sec-link'));
      }
    }

    renderTree(template);

    show($('#doc'));
  }

  /* ---------- 上/下一个项目翻页 ---------- */
  async function renderPager() {
    const pager = $('#detail-pager');
    try {
      const res = await fetch('/api/content', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      const projects = (data.projects || []).filter((p) => p.slug);
      if (projects.length < 2) return;
      const idx = projects.findIndex((p) => p.slug === slug);
      if (idx < 0) return;
      const mk = (item, dir) => {
        const a = el('a', null, '');
        a.href = '/p/' + encodeURIComponent(item.slug);
        a.appendChild(document.createTextNode(dir + ' ' + item.name));
        return a;
      };
      if (projects[idx - 1]) pager.appendChild(mk(projects[idx - 1], '← 上一个项目：'));
      else pager.appendChild(el('span', 'dp-empty', '已是第一个项目'));
      if (projects[idx + 1]) pager.appendChild(mk(projects[idx + 1], '下一个项目：'));
      else pager.appendChild(el('span', 'dp-empty', '已是最后一个项目'));
    } catch (e) {
      // 翻页增强失败不影响正文
    }
  }

  /* ---------- 架构图轻微视差（允许清单 5，仅此一处） ---------- */
  function initDiagramParallax() {
    const fig = document.getElementById('diagram-wrap');
    const img = document.getElementById('diagram');
    if (!fig || !img || reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    fig.addEventListener('mousemove', (e) => {
      const r = fig.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      img.style.transform = 'translate(' + (nx * 2).toFixed(1) + 'px,' + (ny * 1.5).toFixed(1) + 'px)';
    });
    fig.addEventListener('mouseleave', () => { img.style.transform = ''; });
  }

  async function load() {
    if (!slug) {
      $('#load-error').hidden = false;
      return;
    }
    try {
      const res = await fetch('/api/project/' + encodeURIComponent(slug), {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) {
        $('#load-error').textContent = '没有找到这个项目文档，可能链接有误。';
        $('#load-error').hidden = false;
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = await res.json();
      renderDoc(doc);
      renderPager();
      initDiagramParallax();
    } catch (err) {
      $('#load-error').hidden = false;
    }
  }

  load();
})();
