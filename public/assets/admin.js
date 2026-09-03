/* ============================================================
   陆耀威个人站 · 管理端脚本（仅站主使用）
   全部请求走 fetch + 同源 cookie；无框架、无外部依赖。
   接口契约见 docs/API_CONTRACT.md。
   ============================================================ */
(function () {
  'use strict';

  var authView = document.getElementById('auth-view');
  var adminView = document.getElementById('admin-view');
  var panel = document.getElementById('panel');

  var state = { content: null, section: null };

  /* ---------- 工具 ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // form.elements['name'] 可能与集合属性同名冲突，统一走 namedItem
  function val(form, name) {
    var c = form.elements.namedItem(name);
    return c ? c.value : '';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function setBusy(btn, busy) { if (btn) btn.disabled = !!busy; }

  // 统一请求封装：/api/admin/* 收到 401 一律回登录表单并抛 unauthorized
  function api(path, options) {
    options = options || {};
    var opts = { method: options.method || 'GET', credentials: 'same-origin', headers: {} };
    if (options.body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(options.body);
    }
    return fetch(path, opts).then(function (res) {
      if (res.status === 401 && path.indexOf('/api/admin/') === 0) {
        enterLogin('登录已过期，请重新登录');
        throw new Error('unauthorized');
      }
      return res;
    });
  }

  function resError(res) {
    return res.json().then(
      function (data) { return new Error((data && data.error) || '请求失败（' + res.status + '）'); },
      function () { return new Error('请求失败（' + res.status + '）'); }
    );
  }

  // 图片上传：raw body（Content-Type=文件类型），不走 api() 的 JSON 序列化；401 处理一致
  function uploadImage(file) {
    return fetch('/api/admin/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (res) {
      if (res.status === 401) {
        enterLogin('登录已过期，请重新登录');
        throw new Error('unauthorized');
      }
      if (!res.ok) return resError(res).then(function (er) { throw er; });
      return res.json();
    });
  }

  // 仅清理服务器文件：并发执行、不阻塞表单，失败可忽略
  function deleteServerFile(url) {
    if (!url) return;
    fetch('/api/admin/upload', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    }).catch(function () {});
  }

  function handleErr(err, show) {
    if (err && err.message === 'unauthorized') return; // 已由 api() 统一处理
    show(err && err.message ? err.message : '操作失败');
  }

  /* ---------- 章节与字段定义（与契约的内容形状一一对应） ---------- */

  var SECTIONS = [
    { key: 'profile',    no: '01', label: '个人介绍',   en: 'PROFILE' },
    { key: 'projects',   no: '02', label: '项目经历',   en: 'PROJECTS' },
    { key: 'progress',   no: '03', label: '项目进程',   en: 'PROGRESS' },
    { key: 'campus',     no: '04', label: '校园经历',   en: 'CAMPUS' },
    { key: 'honors',     no: '05', label: '荣誉奖项',   en: 'HONORS' },
    { key: 'internship', no: '06', label: '实习经历',   en: 'INTERNSHIP' },
    { key: 'agent',      no: '07', label: '智能体设置', en: 'AGENT' },
    { key: 'backup',     no: '08', label: '备份与恢复', en: 'BACKUP' }
  ];

  // type: 缺省 text 输入框；'area' 单段多行；'lines' 一行一条的列表编辑；'image' 配图分组
  var CAT_FIELDS = {
    projects: [
      { name: 'name',    label: '项目名称' },
      { name: 'tag',     label: '标签（如：独立开发）' },
      { name: 'stack',   label: '技术栈' },
      { name: 'period',  label: '时间' },
      { name: 'link',    label: '链接' },
      { name: 'bullets', label: '要点（一行一条）', type: 'lines' },
      { name: 'image',      label: '配图', type: 'image' },
      { name: 'imageWidth', label: '显示宽度', type: 'image' }
    ],
    progress: [
      { name: 'project', label: '项目' },
      { name: 'status',  label: '状态' },
      { name: 'note',    label: '说明', type: 'area' }
    ],
    campus: [
      { name: 'title',  label: '标题' },
      { name: 'org',    label: '组织 / 社团' },
      { name: 'period', label: '时间' },
      { name: 'detail', label: '详情', type: 'area' }
    ],
    honors: [
      { name: 'name',   label: '奖项名称' },
      { name: 'detail', label: '等级' },
      { name: 'year',   label: '年份' },
      { name: 'image',      label: '配图', type: 'image' },
      { name: 'imageWidth', label: '显示宽度', type: 'image' }
    ],
    internship: [
      { name: 'company', label: '公司' },
      { name: 'role',    label: '职位' },
      { name: 'dept',    label: '部门' },
      { name: 'period',  label: '时间' },
      { name: 'bullets', label: '工作内容（一行一条）', type: 'lines' },
      { name: 'modules', label: '实习模块', type: 'modules' },
      { name: 'takeaway', label: '实习收获', type: 'area' },
      { name: 'image',      label: '配图', type: 'image' },
      { name: 'imageWidth', label: '显示宽度', type: 'image' }
    ]
  };

  // 仅这三类条目有配图（契约见 docs/API_CONTRACT.md）
  var IMAGE_CATS = ['projects', 'honors', 'internship'];

  function blankItem(cat) {
    var item = {};
    CAT_FIELDS[cat].forEach(function (f) { item[f.name] = (f.type === 'lines' || f.type === 'modules') ? [] : ''; });
    // 配图默认值：无图 + 100% 宽度
    if (IMAGE_CATS.indexOf(cat) >= 0) { item.image = ''; item.imageWidth = 100; }
    return item;
  }

  function itemTitle(cat, item) {
    return item.name || item.project || item.title || item.company || ('条目 #' + item.id);
  }

  function itemMeta(cat, item) {
    if (cat === 'projects') return item.stack || '';
    if (cat === 'progress') return item.status || '';
    if (cat === 'campus') return item.period || '';
    if (cat === 'honors') return item.year || '';
    if (cat === 'internship') return item.period || '';
    return '';
  }

  function byKey(key) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].key === key) return SECTIONS[i];
    return SECTIONS[0];
  }

  /* ---------- 脏标记：按表单记录，切节前据此提示 ---------- */

  panel.addEventListener('input', function (e) {
    var f = e.target && e.target.closest ? e.target.closest('form') : null;
    if (f) f.dataset.dirty = '1';
  });

  function anyDirty() {
    var forms = panel.querySelectorAll('form[data-dirty="1"]');
    return forms.length > 0;
  }

  /* ---------- 行内反馈 ---------- */

  function flashSaved() {
    var flag = $('.saved-flag', panel);
    if (!flag) return;
    flag.hidden = false;
    clearTimeout(flag._t);
    flag._t = setTimeout(function () { flag.hidden = true; }, 2000);
  }

  function secError(msg) {
    var e = $('.sec-error', panel);
    if (!e) return;
    e.textContent = '出错：' + msg;
    e.hidden = false;
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.hidden = true; }, 4000);
  }

  /* ---------- 认证流程 ---------- */

  function showSetup() {
    adminView.hidden = true;
    authView.hidden = false;
    $('#auth-title').textContent = '设置管理密码';
    $('#setup-form').hidden = false;
    $('#login-form').hidden = true;
    $('#auth-note').hidden = true;
    $('#setup-pass').focus();
  }

  function showLogin() {
    adminView.hidden = true;
    authView.hidden = false;
    $('#auth-title').textContent = '登录管理端';
    $('#login-form').hidden = false;
    $('#setup-form').hidden = true;
    $('#auth-note').hidden = true;
    var pass = $('#login-pass');
    pass.value = '';
    pass.focus();
  }

  function enterLogin(note) {
    state.section = null;
    panel.innerHTML = '';
    showLogin();
    if (note) {
      var n = $('#auth-note');
      n.textContent = note;
      n.hidden = false;
    }
  }

  function enterAdmin() {
    authView.hidden = true;
    adminView.hidden = false;
    buildNav();
    loadContent().then(
      function () { goto('profile'); },
      function (err) { handleErr(err, secError); }
    );
  }

  $('#setup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#setup-error');
    err.hidden = true;
    var pass = $('#setup-pass').value;
    if (pass !== $('#setup-pass2').value) {
      err.textContent = '两次输入的密码不一致';
      err.hidden = false;
      return;
    }
    var btn = $('#setup-btn');
    setBusy(btn, true);
    fetch('/api/auth/setup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    }).then(function (res) {
      if (res.ok) { enterAdmin(); return; }
      return resError(res).then(function (er) { throw er; });
    }).catch(function (er) {
      err.textContent = er.message || '设置失败';
      err.hidden = false;
    }).then(function () { setBusy(btn, false); });
  });

  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#login-error');
    err.hidden = true;
    var btn = $('#login-btn');
    setBusy(btn, true);
    fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#login-pass').value })
    }).then(function (res) {
      if (res.ok) { enterAdmin(); return; }
      return resError(res).then(function (er) { throw er; });
    }).catch(function (er) {
      err.textContent = er.message === '密码错误' ? '密码错误' : (er.message || '登录失败');
      err.hidden = false;
    }).then(function () { setBusy(btn, false); });
  });

  $('#logout-btn').addEventListener('click', function () {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(function () {
      state.content = null;
      state.section = null;
      panel.innerHTML = '';
      enterLogin('已退出登录');
    });
  });

  /* ---------- 导航与切节 ---------- */

  function buildNav() {
    var nav = $('#side-nav');
    nav.innerHTML = '';
    SECTIONS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-item';
      b.dataset.section = s.key;
      b.innerHTML = '<span class="num">' + s.no + '</span>' + esc(s.label);
      b.addEventListener('click', function () { goto(s.key); });
      nav.appendChild(b);
    });
  }

  function markNav(key) {
    var items = document.querySelectorAll('#side-nav .nav-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('current', items[i].dataset.section === key);
    }
  }

  function goto(key) {
    if (state.section === key) return;
    // 未保存的修改：切节前确认
    if (anyDirty() && !confirm('当前有未保存的修改，不保存就离开吗？')) return;
    state.section = key;
    markNav(key);
    panel.scrollTop = 0;
    if (key === 'profile') renderProfile();
    else if (key === 'agent') renderAgent();
    else if (key === 'backup') renderBackup();
    else renderCategory(key);
  }

  function secHeadHtml(s, extra) {
    return '<header class="sec-head">' +
      '<div><p class="sec-no">' + s.no + ' / ' + s.en + '</p>' +
      '<h2 class="sec-title">' + esc(s.label) + '</h2></div>' +
      '<span class="saved-flag" hidden>已保存</span>' +
      '<span class="sec-error" hidden></span>' +
      (extra || '') +
      '</header>';
  }

  /* ---------- 内容加载 ---------- */

  function loadContent() {
    return api('/api/admin/content').then(function (res) {
      if (!res.ok) return resError(res).then(function (er) { throw er; });
      return res.json();
    }).then(function (data) { state.content = data; });
  }

  /* ---------- 单表单字段模板 ---------- */

  function inputField(name, label, value) {
    return '<div class="field"><label class="label">' + esc(label) + '</label>' +
      '<input type="text" name="' + name + '" value="' + esc(value) + '"></div>';
  }

  function areaField(name, label, value, rows) {
    return '<div class="field field-wide"><label class="label">' + esc(label) + '</label>' +
      '<textarea name="' + name + '" rows="' + (rows || 3) + '">' + esc(value) + '</textarea></div>';
  }

  /* ---------- 个人介绍 ---------- */

  function renderProfile() {
    var s = byKey('profile');
    var p = state.content.profile || {};
    var edu = p.education || {};
    var skills = Array.isArray(p.skills) ? p.skills : [];

    panel.innerHTML = secHeadHtml(s) +
      '<form id="profile-form">' +
        '<fieldset class="group"><legend class="group-title">基本信息</legend><div class="form-grid">' +
          inputField('name', '姓名', p.name) +
          inputField('intent', '求职意向', p.intent) +
          inputField('location', '所在地', p.location) +
          inputField('politics', '政治面貌', p.politics) +
          inputField('email', '邮箱', p.email) +
        '</div>' +
        areaField('summary', '个人简介', p.summary, 5) +
        areaField('selfEval', '自我评价', p.selfEval, 4) +
        '</fieldset>' +
        '<fieldset class="group"><legend class="group-title">教育经历</legend><div class="form-grid">' +
          inputField('edu_school', '学校', edu.school) +
          inputField('edu_major', '专业', edu.major) +
          inputField('edu_period', '在校时间', edu.period) +
          inputField('edu_gpa', 'GPA', edu.gpa) +
        '</div>' +
        areaField('edu_courses', '主修课程', edu.courses, 2) +
        '</fieldset>' +
        '<fieldset class="group"><legend class="group-title">技能</legend>' +
          '<div id="skill-rows"></div>' +
          '<button type="button" class="btn" id="add-skill">添加一组</button>' +
        '</fieldset>' +
        '<p class="form-error" id="profile-error" hidden></p>' +
        '<div class="form-foot"><button type="submit" class="btn btn-solid">保存个人介绍</button></div>' +
      '</form>';

    var rows = $('#skill-rows');
    if (!skills.length) rows.appendChild(skillRow('', ''));
    skills.forEach(function (sk) { rows.appendChild(skillRow(sk.group, sk.items)); });
    $('#add-skill').addEventListener('click', function () {
      rows.appendChild(skillRow('', ''));
    });

    $('#profile-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var err = $('#profile-error');
      err.hidden = true;
      var body = {
        name: val(form, 'name').trim(),
        intent: val(form, 'intent').trim(),
        location: val(form, 'location').trim(),
        politics: val(form, 'politics').trim(),
        email: val(form, 'email').trim(),
        summary: val(form, 'summary').trim(),
        selfEval: val(form, 'selfEval').trim(),
        education: {
          school: val(form, 'edu_school').trim(),
          major: val(form, 'edu_major').trim(),
          period: val(form, 'edu_period').trim(),
          gpa: val(form, 'edu_gpa').trim(),
          courses: val(form, 'edu_courses').trim()
        },
        skills: collectSkills()
      };
      var btn = form.querySelector('[type=submit]');
      setBusy(btn, true);
      api('/api/admin/profile', { method: 'PUT', body: body }).then(function (res) {
        if (!res.ok) return resError(res).then(function (er) { throw er; });
        state.content.profile = body;
        delete form.dataset.dirty;
        flashSaved();
      }).catch(function (er) {
        handleErr(er, function (msg) { err.textContent = msg; err.hidden = false; });
      }).then(function () { setBusy(btn, false); });
    });
  }

  function skillRow(group, items) {
    var row = el('<div class="skill-row">' +
      '<input type="text" name="skill_group" placeholder="分组（如：Agent / MCP）" value="' + esc(group) + '">' +
      '<input type="text" name="skill_items" placeholder="该组技能内容" value="' + esc(items) + '">' +
      '<button type="button" class="btn-text" data-remove>移除</button>' +
      '</div>');
    row.querySelector('[data-remove]').addEventListener('click', function () { row.remove(); });
    return row;
  }

  function collectSkills() {
    var out = [];
    var rows = panel.querySelectorAll('#skill-rows .skill-row');
    for (var i = 0; i < rows.length; i++) {
      var g = rows[i].querySelector('[name=skill_group]').value.trim();
      var it = rows[i].querySelector('[name=skill_items]').value.trim();
      if (g || it) out.push({ group: g, items: it });
    }
    return out;
  }

  /* ---------- 五类条目（项目经历 / 项目进程 / 校园经历 / 荣誉奖项 / 实习经历） ---------- */

  function renderCategory(key) {
    var s = byKey(key);
    panel.innerHTML = secHeadHtml(s, '<button type="button" class="btn" id="add-btn">新增条目</button>') +
      '<div class="item-list" id="item-list"></div>';
    $('#add-btn').addEventListener('click', function () { openNewItem(key); });
    renderItems(key);
  }

  function renderItems(key) {
    var list = $('#item-list');
    list.innerHTML = '';
    var arr = state.content[key] || [];
    if (!arr.length) {
      list.appendChild(el('<p class="empty-note">暂无条目，点上方「新增条目」添加。</p>'));
      return;
    }
    arr.forEach(function (item, i) {
      var row = el('<article class="item">' +
        '<div class="item-row">' +
          '<span class="item-idx">' + pad(i + 1) + '</span>' +
          '<span class="item-title">' + esc(itemTitle(key, item)) + '</span>' +
          '<span class="item-meta">' + esc(itemMeta(key, item)) + '</span>' +
          '<span class="item-ops">' +
            '<button type="button" data-op="edit">编辑</button>' +
            '<button type="button" data-op="up"' + (i === 0 ? ' disabled' : '') + '>上移</button>' +
            '<button type="button" data-op="down"' + (i === arr.length - 1 ? ' disabled' : '') + '>下移</button>' +
            '<button type="button" data-op="del">删除</button>' +
          '</span>' +
        '</div>' +
        '</article>');
      row.querySelector('[data-op=edit]').addEventListener('click', function () { openEditor(row, key, item); });
      row.querySelector('[data-op=up]').addEventListener('click', function () { moveItem(key, i, -1); });
      row.querySelector('[data-op=down]').addEventListener('click', function () { moveItem(key, i, 1); });
      row.querySelector('[data-op=del]').addEventListener('click', function () { removeItem(key, item); });
      list.appendChild(row);
    });
  }

  function buildItemForm(key, item) {
    var form = el('<form class="item-form"><div class="form-grid"></div>' +
      '<p class="form-error" hidden></p>' +
      '<div class="form-foot">' +
        '<button type="submit" class="btn btn-solid">' + (item.id ? '保存' : '创建') + '</button>' +
        '<button type="button" class="btn" data-cancel>取消</button>' +
      '</div></form>');
    var grid = form.querySelector('.form-grid');
    CAT_FIELDS[key].forEach(function (f) {
      if (f.type === 'image') return; // 配图字段由下方分组整体渲染
      var v = item[f.name];
      if (f.type === 'modules') {
        grid.appendChild(modulesGroupHtml(v));
      } else if (f.type === 'lines') {
        var lines = Array.isArray(v) ? v : [];
        grid.appendChild(el(
          '<div class="field field-wide"><label class="label">' + esc(f.label) + '</label>' +
          '<textarea name="' + f.name + '" rows="' + Math.max(4, lines.length + 1) + '">' +
          esc(lines.join('\n')) + '</textarea></div>'
        ));
      } else if (f.type === 'area') {
        grid.appendChild(el(
          '<div class="field field-wide"><label class="label">' + esc(f.label) + '</label>' +
          '<textarea name="' + f.name + '" rows="3">' + esc(v || '') + '</textarea></div>'
        ));
      } else {
        grid.appendChild(el(
          '<div class="field"><label class="label">' + esc(f.label) + '</label>' +
          '<input type="text" name="' + f.name + '" value="' + esc(v || '') + '"></div>'
        ));
      }
    });
    if (IMAGE_CATS.indexOf(key) >= 0) form.appendChild(imageGroupHtml(item));
    return form;
  }

  function imageGroupHtml(item) {
    var url = (item && item.image) || '';
    var w = Number(item && item.imageWidth);
    if ([40, 60, 80, 100].indexOf(w) < 0) w = 100; // 旧数据缺 imageWidth → 默认 100
    var opts = [100, 80, 60, 40].map(function (n) {
      return '<option value="' + n + '"' + (n === w ? ' selected' : '') + '>' + n + '%</option>';
    }).join('');
    return el(
      '<fieldset class="group group-img" data-img-group>' +
        '<legend class="group-title">配图</legend>' +
        '<input type="hidden" name="image" value="' + esc(url) + '" data-img-hidden>' +
        '<div class="img-preview-wrap" hidden>' +
          '<img class="img-preview" alt="配图预览" data-img-preview>' +
          '<p class="img-url" data-img-url></p>' +
        '</div>' +
        '<p class="hint" data-img-hint>尚未上传配图，选择文件即上传到服务器，保存时随条目一起写入。</p>' +
        '<div class="img-controls">' +
          '<label class="btn img-pick"><span data-img-pick-text>选择图片</span>' +
            '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img-file hidden></label>' +
          '<button type="button" class="btn-text" data-img-remove hidden>移除图片</button>' +
        '</div>' +
        '<div class="img-width-row">' +
          '<label class="label">显示宽度</label>' +
          '<select name="imageWidth">' + opts + '</select>' +
        '</div>' +
        '<p class="form-error" data-img-error hidden></p>' +
      '</fieldset>'
    );
  }

  function wireImageGroup(form) {
    var g = form.querySelector('[data-img-group]');
    if (!g) return;
    var hidden = g.querySelector('[data-img-hidden]');
    var fileInput = g.querySelector('[data-img-file]');
    var wrap = g.querySelector('.img-preview-wrap');
    var preview = g.querySelector('[data-img-preview]');
    var urlEl = g.querySelector('[data-img-url]');
    var hint = g.querySelector('[data-img-hint]');
    var pickText = g.querySelector('[data-img-pick-text]');
    var removeBtn = g.querySelector('[data-img-remove]');
    var err = g.querySelector('[data-img-error]');
    var uploaded = []; // 本表单会话中上传过的 url；仅在此时删除服务器文件，避免取消编辑误删已保存图片

    function render() {
      var url = (hidden.value || '').trim();
      var has = !!url;
      wrap.hidden = !has;
      hint.hidden = has;
      removeBtn.hidden = !has;
      pickText.textContent = has ? '重新选择' : '选择图片';
      if (has) {
        preview.src = url;
        urlEl.textContent = url;
      } else {
        preview.removeAttribute('src');
        urlEl.textContent = '';
      }
    }

    function showErr(msg) {
      err.textContent = msg;
      err.hidden = false;
    }

    render();

    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].indexOf(f.type) < 0) {
        showErr('仅支持 PNG / JPEG / WebP / GIF 图片');
        fileInput.value = '';
        return;
      }
      var oldUrl = (hidden.value || '').trim();
      fileInput.disabled = true;
      err.hidden = true;
      showErr('上传中…');
      uploadImage(f).then(function (data) {
        var url = (data && data.url) || '';
        hidden.value = url;
        if (oldUrl && uploaded.indexOf(oldUrl) >= 0) { // 本会话内换图：顺手清理旧文件
          uploaded.splice(uploaded.indexOf(oldUrl), 1);
          deleteServerFile(oldUrl);
        }
        if (url) uploaded.push(url);
        render();
        err.hidden = true;
      }).catch(function (er) {
        handleErr(er, showErr);
      }).then(function () {
        fileInput.disabled = false;
        fileInput.value = '';
      });
    });

    removeBtn.addEventListener('click', function () {
      var url = (hidden.value || '').trim();
      hidden.value = '';
      render();
      if (url && uploaded.indexOf(url) >= 0) {
        uploaded.splice(uploaded.indexOf(url), 1);
        deleteServerFile(url);
      }
    });
  }

  /* ---------- 实习模块编辑器（每模块：标题/摘要/要点，可增删） ---------- */

  function moduleItemHtml(mod) {
    mod = mod || {};
    var bullets = (Array.isArray(mod.bullets) ? mod.bullets : []).join('\n');
    return el(
      '<div class="module-item" data-module>' +
        '<div class="field"><label class="label">模块标题</label>' +
          '<input type="text" data-module-title value="' + esc(mod.title || '') + '"></div>' +
        '<div class="field"><label class="label">模块摘要</label>' +
          '<input type="text" data-module-summary value="' + esc(mod.summary || '') + '"></div>' +
        '<div class="field"><label class="label">要点（一行一条）</label>' +
          '<textarea data-module-bullets rows="3">' + esc(bullets) + '</textarea></div>' +
        '<button type="button" class="btn-text module-remove" data-module-remove>删除该模块</button>' +
      '</div>'
    );
  }

  function modulesGroupHtml(mods) {
    var list = Array.isArray(mods) ? mods : [];
    var fieldset = el(
      '<fieldset class="group group-modules" data-modules-group>' +
        '<legend class="group-title">实习模块</legend>' +
        '<div class="modules-list" data-modules-list></div>' +
        '<button type="button" class="btn-text" data-module-add>+ 新增模块</button>' +
        '<p class="hint">每个模块独立的标题 / 摘要 / 要点（一行一条）；全部留空的模块不会保存。</p>' +
      '</fieldset>'
    );
    var listEl = fieldset.querySelector('[data-modules-list]');
    for (var i = 0; i < list.length; i++) listEl.appendChild(moduleItemHtml(list[i]));
    return fieldset;
  }

  function readModules(form) {
    var out = [];
    var items = form.querySelectorAll('[data-module]');
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var title = (m.querySelector('[data-module-title]').value || '').trim();
      var summary = (m.querySelector('[data-module-summary]').value || '').trim();
      var bullets = (m.querySelector('[data-module-bullets]').value || '')
        .split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
      if (title || summary || bullets.length) out.push({ title: title, summary: summary, bullets: bullets });
    }
    return out;
  }

  function wireModulesGroup(form) {
    var group = form.querySelector('[data-modules-group]');
    if (!group) return;
    var listEl = group.querySelector('[data-modules-list]');
    var addBtn = group.querySelector('[data-module-add]');
    function bindRemove(moduleEl) {
      var rm = moduleEl.querySelector('[data-module-remove]');
      rm.addEventListener('click', function () { moduleEl.parentNode.removeChild(moduleEl); });
    }
    for (var i = 0; i < listEl.children.length; i++) bindRemove(listEl.children[i]);
    addBtn.addEventListener('click', function () {
      var m = moduleItemHtml(null);
      listEl.appendChild(m);
      bindRemove(m);
      var inp = m.querySelector('input');
      if (inp) inp.focus();
    });
  }

  function collectItem(key, form) {
    var item = {};
    CAT_FIELDS[key].forEach(function (f) {
      if (f.type === 'image') return;
      if (f.type === 'modules') { item[f.name] = readModules(form); return; }
      var raw = val(form, f.name);
      item[f.name] = f.type === 'lines'
        ? raw.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; })
        : raw.trim();
    });
    if (IMAGE_CATS.indexOf(key) >= 0) {
      item.image = val(form, 'image').trim();
      var w = Number(val(form, 'imageWidth'));
      item.imageWidth = [40, 60, 80, 100].indexOf(w) >= 0 ? w : 100; // 补全默认值再提交
    }
    return item;
  }

  // 同屏只保留一个编辑态，打开新表单前收起其它表单
  function closeEditors() {
    var forms = panel.querySelectorAll('.item-form');
    for (var i = 0; i < forms.length; i++) {
      var wrap = forms[i].closest('.new-item');
      (wrap || forms[i]).remove();
    }
  }

  function openEditor(row, key, item) {
    var existing = row.querySelector('.item-form');
    if (existing) { existing.remove(); return; }
    closeEditors();
    var form = buildItemForm(key, item);
    wireItemForm(form, key, item);
    row.appendChild(form);
    var first = form.querySelector('input,textarea');
    if (first) first.focus();
  }

  function openNewItem(key) {
    var existing = document.getElementById('new-item-wrap');
    if (existing) { var f0 = existing.querySelector('input,textarea'); if (f0) f0.focus(); return; }
    closeEditors();
    var wrap = el('<article class="item new-item" id="new-item-wrap"><p class="new-item-label">新增条目</p></article>');
    var form = buildItemForm(key, blankItem(key));
    wireItemForm(form, key, null);
    form.querySelector('[data-cancel]').addEventListener('click', function () { wrap.remove(); });
    wrap.appendChild(form);
    var list = $('#item-list');
    var note = list.querySelector('.empty-note');
    if (note) note.remove();
    list.insertBefore(wrap, list.firstChild);
    var first = form.querySelector('input,textarea');
    if (first) first.focus();
  }

  function wireItemForm(form, key, item) {
    wireImageGroup(form);
    wireModulesGroup(form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = collectItem(key, form);
      var err = form.querySelector('.form-error');
      err.hidden = true;
      var btn = form.querySelector('[type=submit]');
      setBusy(btn, true);
      var req = item && item.id
        ? api('/api/admin/' + key + '/' + item.id, { method: 'PUT', body: body })
        : api('/api/admin/' + key, { method: 'POST', body: body });
      req.then(function (res) {
        if (!res.ok) return resError(res).then(function (er) { throw er; });
        return res.json().catch(function () { return null; });
      }).then(function (saved) {
        var arr = state.content[key];
        if (item && item.id) {
          for (var i = 0; i < arr.length; i++) {
            if (arr[i].id === item.id) { arr[i] = Object.assign({ id: item.id }, body); break; }
          }
        } else {
          arr.unshift(Object.assign({}, body, saved && saved.id ? saved : {}));
        }
        renderItems(key);
        flashSaved();
      }).catch(function (er) {
        handleErr(er, function (msg) { err.textContent = msg; err.hidden = false; });
      }).then(function () { setBusy(btn, false); });
    });
    form.querySelector('[data-cancel]').addEventListener('click', function () { form.remove(); });
  }

  function moveItem(key, idx, delta) {
    var arr = state.content[key];
    var j = idx + delta;
    if (!arr || j < 0 || j >= arr.length) return;
    var t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    api('/api/admin/' + key + '/order', {
      method: 'PUT',
      body: { order: arr.map(function (x) { return x.id; }) }
    }).then(function (res) {
      if (!res.ok) return resError(res).then(function (er) { throw er; });
      renderItems(key);
    }).catch(function (er) {
      handleErr(er, secError);
      renderItems(key); // 排序失败时回滚显示
    });
  }

  function removeItem(key, item) {
    if (!confirm('确定删除「' + itemTitle(key, item) + '」？删除后不可恢复。')) return;
    api('/api/admin/' + key + '/' + item.id, { method: 'DELETE' }).then(function (res) {
      if (!res.ok) return resError(res).then(function (er) { throw er; });
      state.content[key] = state.content[key].filter(function (x) { return x.id !== item.id; });
      renderItems(key);
    }).catch(function (er) { handleErr(er, secError); });
  }

  /* ---------- 智能体设置 ---------- */

  function renderAgent() {
    var s = byKey('agent');
    panel.innerHTML = secHeadHtml(s) + '<p class="loading">加载中…</p>';
    api('/api/admin/settings').then(function (res) {
      if (!res.ok) return resError(res).then(function (er) { throw er; });
      return res.json();
    }).then(function (st) {
      panel.innerHTML = secHeadHtml(s) + agentFormHtml(st);
      $('#agent-form').addEventListener('submit', saveAgent);
    }).catch(function (er) { handleErr(er, secError); });
  }

  function agentFormHtml(st) {
    var masked = st.agentApiKeySet ? (st.agentApiKeyMasked || '已配置') : '';
    return '<form id="agent-form">' +
      '<div class="form-grid">' +
        inputField('agentBaseUrl', '接口 Base URL', st.agentBaseUrl || 'https://api.deepseek.com') +
        inputField('agentModel', '模型', st.agentModel || 'deepseek-chat') +
      '</div>' +
      '<div class="field"><label class="label">API Key</label>' +
        '<input type="password" name="agentApiKey" autocomplete="off" placeholder="' + esc(masked || '未配置') + '">' +
        '<p class="hint">留空表示不修改已存 Key' + (masked ? '（当前：' + esc(masked) + '）' : '（当前未配置）') + '</p>' +
      '</div>' +
      '<label class="check-line"><input type="checkbox" name="clearApiKey"> 清除已存 Key（清除后访客端对话走离线兜底）</label>' +
      '<div class="field field-wide"><label class="label">追加系统提示词（追加在系统提示末尾）</label>' +
        '<textarea name="systemPromptExtra" rows="6">' + esc(st.systemPromptExtra || '') + '</textarea></div>' +
      '<p class="note-line">未配置 Key 时，访客端对话走基于站点内容的离线摘要兜底。</p>' +
      '<div class="form-foot"><button type="submit" class="btn btn-solid">保存设置</button></div>' +
      '<p class="form-error" id="agent-error" hidden></p>' +
      '</form>';
  }

  function saveAgent(e) {
    e.preventDefault();
    var form = e.target;
    var err = $('#agent-error');
    err.hidden = true;
    var clear = form.elements.namedItem('clearApiKey').checked;
    var body = {
      agentBaseUrl: val(form, 'agentBaseUrl').trim() || 'https://api.deepseek.com',
      agentModel: val(form, 'agentModel').trim() || 'deepseek-chat',
      agentApiKey: clear ? '' : val(form, 'agentApiKey').trim(), // 空串 = 不修改
      clearApiKey: clear,
      systemPromptExtra: val(form, 'systemPromptExtra')
    };
    var btn = form.querySelector('[type=submit]');
    setBusy(btn, true);
    api('/api/admin/settings', { method: 'PUT', body: body }).then(function (res) {
      if (!res.ok) return resError(res).then(function (er) { throw er; });
      return renderAgent(); // 重新拉取，刷新掩码占位
    }).then(function () {
      flashSaved();
    }).catch(function (er) {
      handleErr(er, function (msg) { err.textContent = msg; err.hidden = false; });
    }).then(function () { setBusy(btn, false); });
  }

  /* ---------- 备份与恢复 ---------- */

  function renderBackup() {
    var s = byKey('backup');
    panel.innerHTML = secHeadHtml(s) +
      '<section class="backup-block">' +
        '<h3 class="block-title">备份</h3>' +
        '<p class="hint">下载全部六类内容的 JSON 文件（不含智能体 API Key）。</p>' +
        '<div class="form-foot"><button type="button" class="btn btn-solid" id="backup-btn">下载备份 JSON</button>' +
        '<span class="sec-error" id="backup-error" hidden></span></div>' +
      '</section>' +
      '<section class="backup-block">' +
        '<h3 class="block-title">恢复</h3>' +
        '<p class="hint">选择此前导出的备份文件。恢复会覆盖六类内容，不影响登录密码与智能体设置。</p>' +
        '<input type="file" id="restore-file" accept=".json,application/json">' +
        '<div class="form-foot"><button type="button" class="btn" id="restore-btn" disabled>恢复内容</button></div>' +
        '<p class="form-error" id="restore-error" hidden></p>' +
        '<p class="hint" id="restore-ok" hidden></p>' +
      '</section>';

    $('#backup-btn').addEventListener('click', doBackup);

    var fileInput = $('#restore-file');
    var restoreBtn = $('#restore-btn');
    var chosen = null;
    fileInput.addEventListener('change', function () {
      chosen = (fileInput.files && fileInput.files[0]) || null;
      restoreBtn.disabled = !chosen;
      $('#restore-error').hidden = true;
      $('#restore-ok').hidden = true;
    });
    restoreBtn.addEventListener('click', function () { doRestore(chosen); });
  }

  function backupFilename() {
    var d = new Date();
    return 'content-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
  }

  function doBackup() {
    var errEl = $('#backup-error');
    errEl.hidden = true;
    api('/api/admin/backup').then(function (res) {
      if (!res.ok) return resError(res).then(function (er) { throw er; });
      return res.blob();
    }).then(function (blob) {
      // fetch + blob 下载，确保同源 cookie 随请求携带
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = backupFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function (er) { handleErr(er, function (msg) { errEl.textContent = '出错：' + msg; errEl.hidden = false; }); });
  }

  function doRestore(file) {
    var errEl = $('#restore-error');
    var okEl = $('#restore-ok');
    errEl.hidden = true;
    okEl.hidden = true;
    if (!file) return;
    if (!confirm('恢复会覆盖当前六类内容，确定继续？')) return;
    file.text().then(function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (ex) {
        errEl.textContent = '文件解析失败：不是有效的 JSON（' + ex.message + '）';
        errEl.hidden = false;
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || !('profile' in data)) {
        errEl.textContent = '文件内容不像本站备份（缺少 profile 字段），已取消恢复。';
        errEl.hidden = false;
        return;
      }
      return api('/api/admin/restore', { method: 'POST', body: data }).then(function (res) {
        if (!res.ok) return resError(res).then(function (er) { throw er; });
        return loadContent().then(function () {
          okEl.textContent = '恢复完成，内容已刷新。';
          okEl.hidden = false;
        });
      });
    }).catch(function (er) { handleErr(er, function (msg) { errEl.textContent = msg; errEl.hidden = false; }); });
  }

  /* ---------- 入口 ---------- */

  fetch('/api/auth/state', { credentials: 'same-origin' })
    .then(function (res) { return res.json(); })
    .then(function (st) {
      if (st.setupNeeded) showSetup();
      else if (st.authenticated) enterAdmin();
      else showLogin();
    })
    .catch(function () {
      showLogin();
      var n = $('#auth-note');
      n.textContent = '无法连接服务器，请稍后刷新重试。';
      n.hidden = false;
    });
})();
