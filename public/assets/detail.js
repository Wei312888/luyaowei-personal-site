/* 陆耀威个人站 · 项目深度详情页(/p/:slug)
   内容来自 GET /api/project/:slug 按 slug 渲染 projectDocs，不在前端硬编码项目内容。
   字段名以 docs/API_CONTRACT.md 为准：slug / name / tagline / stack / summary /
   diagram / architecture / mcpTools / httpEndpoints / challenges / results / link。 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

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

  // 更新 <head> 中某个 meta / link 的值（用于 SEO、OG 分享）
  const setMeta = (attr, name, value) => {
    const m = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (m) m.setAttribute('content', value);
  };

  // 渲染 MCP 工具 / HTTP 接口清单：name(或 method+path) + 说明
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

  function renderDoc(doc) {
    document.title = doc.name + ' · 陆耀威';

    // 详情页独立 og:title / og:description / og:url（项目名），便于微信 / 社交分享
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

    // 01 架构链路
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
    // 架构图或架构清单任一有内容才显示该节
    if (doc.diagram || archList.children.length) show($('#sec-arch'));

    // 02 MCP 工具清单
    if (Array.isArray(doc.mcpTools) && doc.mcpTools.length) {
      renderTools($('#mcp-list'), doc.mcpTools, 'mcp');
      show($('#sec-mcp'));
    }

    // 03 HTTP 接口
    if (Array.isArray(doc.httpEndpoints) && doc.httpEndpoints.length) {
      renderTools($('#http-list'), doc.httpEndpoints, 'http');
      show($('#sec-http'));
    }

    // 04 关键难点与方案
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

    // 05 量化成果
    if (Array.isArray(doc.results) && doc.results.length) {
      const ul = $('#result-list');
      doc.results.forEach((r) => ul.appendChild(el('li', null, r)));
      show($('#sec-results'));
    }

    // 06 开源 / 演示链接（可选，空串不显示）
    if (doc.link) {
      const a = $('#link-a');
      a.href = doc.link;
      a.textContent = '项目链接';
      show($('#sec-link'));
    }

    show($('#doc'));
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
      renderDoc(await res.json());
    } catch (err) {
      $('#load-error').hidden = false;
    }
  }

  load();
})();
