/* 陆耀威个人站 · Cloudflare Workers 适配版
   路由/字段/行为与 Node 版(lib/*.js + server.js)保持一致:
   GET /api/content · POST /api/chat(SSE) · /api/auth/* · /api/admin/* · /p/:slug 详情页
   ASSETS 提供 public/ 静态资源;D1 持久化 items + kv(种子自动导入)。 */

import { Hono } from 'hono';
import seedData from '../seed/content-seed.json';

const CATEGORIES = ['projects', 'progress', 'campus', 'honors', 'internship'];
// 项目 slug 兜底映射:按名称精确匹配(与 seed 保持一致),运行时查找与渲染共用
const PROJECT_SLUG_BY_NAME = {
  'EDA Agent 桥（嘉立创 EDA 扩展 + 网关 + MCP）': 'eda-agent-bridge',
  'wei+ 嵌入式信号串口助手': 'wei-plus',
  '周期信号测量分析装置（简易示波器）': 'signal-measurement-device',
  '模拟信号无线收发机': 'wireless-transceiver',
  '宽带混合信号分离与锁相重建系统': 'broadband-signal-separation'
};
const CATEGORY_LABELS = {
  projects: '项目经历',
  progress: '项目进展',
  campus: '校园经历',
  honors: '获奖情况',
  internship: '实习经历'
};
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const SITE_EMAIL = 'luyaowei9930@163.com';
const OFFLINE_NOTE = '（AI 尚未接入，以下基于站点公开资料自动整理）';
const COOKIE_NAME = 'lyw_session';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/.{1,2}/g).map((h) => parseInt(h, 16)));
const base64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacHex(secretStr, dataStr) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secretStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataStr));
  return toHex(sig);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return `${toHex(salt)}:${toHex(bits)}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100000 }, key, 256);
  const a = toHex(bits);
  let diff = a.length ^ hashHex.length;
  for (let i = 0; i < Math.min(a.length, hashHex.length); i++) diff |= a.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

function parseCookies(req) {
  const cookies = {};
  const raw = req.headers.get('cookie');
  if (!raw) return cookies;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

/* ---------- D1 存储 ---------- */

const TECH_NOTES_KV = 'techNotes_json';
const QUICK_KV = 'quick_questions_json';
// 管理端表单不编辑的 v2 元字段：整体替换保存时若请求体缺这些键，沿用库里旧值（与 Node 版一致）
const PROJECT_META_PRESERVE = ['slug', 'tier', 'line', 'param'];

async function ensureSchema(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL)');
  await db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
  const emptyItems = (await db.prepare('SELECT COUNT(*) AS n FROM items').first()).n === 0;
  const hasProfile = (await db.prepare('SELECT value FROM kv WHERE key = ?').bind('profile_json').first());
  if (emptyItems && !hasProfile) await importSeed(db);
  // 幂等迁移:校园经历、projectDocs 增量合并、techNotes 知识库、quickQuestions、项目 v2 元字段（与 Node 版 migrate 一致）
  const now = new Date().toISOString();
  const campusCount = (await db.prepare("SELECT COUNT(*) AS n FROM items WHERE category='campus'").first()).n;
  if (campusCount === 0) {
    const list = seedData.campus || [];
    const ins = db.prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)');
    list.forEach((item, i) => ins.bind('campus', i, JSON.stringify(stripId(item)), now).run());
  }
  await mergeMissingSlugs(db, 'projectDocs_json', seedData.projectDocs);
  await mergeMissingSlugs(db, TECH_NOTES_KV, seedData.techNotes);
  const hasQuick = await db.prepare('SELECT value FROM kv WHERE key = ?').bind(QUICK_KV).first();
  if (!hasQuick && Array.isArray(seedData.quickQuestions) && seedData.quickQuestions.length) {
    await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?)').bind(QUICK_KV, JSON.stringify(seedData.quickQuestions)).run();
  }
  await migrateProjectMetaWorkers(db, seedData.projects);
}

// kv 整包对象按缺失 slug 增量合并（幂等，不动既有条目）
async function mergeMissingSlugs(db, key, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  const row = await db.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  if (!row) {
    await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?)').bind(key, JSON.stringify(source)).run();
    return;
  }
  try {
    const existing = JSON.parse(row.value);
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(source)).run();
      return;
    }
    let changed = false;
    for (const slug of Object.keys(source)) {
      if (existing[slug] === undefined) { existing[slug] = source[slug]; changed = true; }
    }
    if (changed) {
      await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(existing)).run();
    }
  } catch (e) {
    /* 既有 kv 解析失败：保持现状 */
  }
}

// 项目 v2 元字段（tier/line/param/period）：按 slug 匹配 seed，仅当字段缺失或为空时补全（幂等）
async function migrateProjectMetaWorkers(db, seedProjects) {
  const seedBySlug = {};
  (Array.isArray(seedProjects) ? seedProjects : []).forEach((it) => { if (it && it.slug) seedBySlug[it.slug] = it; });
  if (!Object.keys(seedBySlug).length) return;
  const rows = await db.prepare("SELECT id, data FROM items WHERE category = 'projects' ORDER BY sort ASC, id ASC").all();
  const upd = db.prepare('UPDATE items SET data = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const r of rows.results) {
    let data;
    try { data = JSON.parse(r.data); } catch (e) { continue; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const seedItem = data.slug ? seedBySlug[data.slug] : null;
    if (!seedItem) continue;
    let changed = false;
    for (const key of ['tier', 'line', 'param', 'period']) {
      if (seedItem[key] && (data[key] === undefined || data[key] === null || data[key] === '')) {
        data[key] = seedItem[key];
        changed = true;
      }
    }
    if (changed) await upd.bind(JSON.stringify(data), now, r.id).run();
  }
}

function stripId(item) {
  const { id, ...data } = item;
  return data;
}

async function importSeed(db) {
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?)').bind('profile_json', JSON.stringify(seedData.profile)).run();
  const ins = db.prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)');
  for (const category of CATEGORIES) {
    const list = seedData[category] || [];
    for (let i = 0; i < list.length; i++) await ins.bind(category, i, JSON.stringify(stripId(list[i])), now).run();
  }
  await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?)').bind('projectDocs_json', JSON.stringify(seedData.projectDocs || {})).run();
  if (seedData.techNotes && typeof seedData.techNotes === 'object') {
    await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?)').bind(TECH_NOTES_KV, JSON.stringify(seedData.techNotes)).run();
  }
  if (Array.isArray(seedData.quickQuestions) && seedData.quickQuestions.length) {
    await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?)').bind(QUICK_KV, JSON.stringify(seedData.quickQuestions)).run();
  }
}

async function kvGet(db, key) {
  const row = await db.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}
async function kvSet(db, key, value) {
  await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}
async function kvDel(db, key) {
  await db.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();
}

async function getContent(db) {
  const profileRaw = await kvGet(db, 'profile_json');
  const content = { profile: profileRaw ? JSON.parse(profileRaw) : {} };
  for (const category of CATEGORIES) {
    const rows = await db.prepare('SELECT id, data FROM items WHERE category = ? ORDER BY sort ASC, id ASC').bind(category).all();
    content[category] = rows.results.map((r) => ({ ...JSON.parse(r.data), id: Number(r.id) }));
  }
  // 运行时补 slug:旧库项目条目可能没有 slug 字段,按名称映射补全(不落库,幂等)
  (content.projects || []).forEach((it, i) => {
    if (!it.slug) it.slug = PROJECT_SLUG_BY_NAME[it.name] || `p-${it.id || i + 1}`;
  });
  // v2 快捷问题：seed 维护的站点配置；kv 缺失时前端用内置默认值兜底
  const quickRaw = await kvGet(db, QUICK_KV);
  if (quickRaw) {
    try {
      const quick = JSON.parse(quickRaw);
      if (Array.isArray(quick) && quick.length) content.quickQuestions = quick;
    } catch (e) {
      /* 解析失败则不下发 */
    }
  }
  return content;
}

async function getProjectDocs(db) {
  const raw = await kvGet(db, 'projectDocs_json');
  return raw ? JSON.parse(raw) : {};
}
async function getProjectDoc(db, slug) {
  const docs = await getProjectDocs(db);
  return docs[slug] || null;
}
// 详情文档解析:优先 projectDocs;其次 seed 中的完整文档(旧库 projectDocs_json 可能
// 缺 3 个硬件项目——种子回退保证部署/升级后自动补全,无需手工迁移 kv);
// 仍未命中则在项目列表内按 slug(含名称兜底映射)查找,合成骨架文档;完全未命中返回 null
async function getProjectDocOrSkeleton(db, slug) {
  const doc = await getProjectDoc(db, slug);
  if (doc) return doc;
  const seedDoc = seedData.projectDocs && seedData.projectDocs[slug];
  if (seedDoc) return seedDoc;
  const projects = (await getContent(db)).projects || [];
  const project = projects.find(
    (it) => (it.slug && it.slug === slug) || PROJECT_SLUG_BY_NAME[it.name] === slug || slug === `p-${it.id}`
  );
  if (!project) return null;
  return {
    slug,
    name: project.name || '',
    tagline: '',
    stack: project.stack || '',
    summary: (Array.isArray(project.bullets) && project.bullets[0]) || '',
    diagram: '',
    architecture: [],
    mcpTools: [],
    httpEndpoints: [],
    challenges: [],
    results: [],
    bullets: (Array.isArray(project.bullets) ? project.bullets : []).filter(Boolean),
    period: project.period || '',
    link: project.link || '',
    skeleton: true
  };
}

async function insertItem(db, category, body) {
  const { id, ...data } = body;
  const max = await db.prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS s FROM items WHERE category = ?').bind(category).first();
  const res = await db.prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)').bind(category, max.s, JSON.stringify(data), new Date().toISOString()).run();
  return { ...data, id: Number(res.meta.last_row_id) };
}
async function updateItem(db, category, id, body) {
  const { id: ignored, ...data } = body;
  if (category === 'projects') {
    // 管理端表单只回传其声明的字段：保留 v2 元字段与 slug（请求体缺键时沿用库值，避免误删）
    const row = await db.prepare('SELECT data FROM items WHERE category = ? AND id = ?').bind(category, id).first();
    if (row) {
      try {
        const prev = JSON.parse(row.data);
        if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
          for (const key of PROJECT_META_PRESERVE) {
            if (prev[key] !== undefined && (data[key] === undefined || data[key] === null)) data[key] = prev[key];
          }
        }
      } catch (e) {
        /* 旧数据解析失败则不做合并保护 */
      }
    }
  }
  const res = await db.prepare('UPDATE items SET data = ?, updated_at = ? WHERE category = ? AND id = ?').bind(JSON.stringify(data), new Date().toISOString(), category, id).run();
  return res.meta.changes > 0;
}
async function deleteItem(db, category, id) {
  const res = await db.prepare('DELETE FROM items WHERE category = ? AND id = ?').bind(category, id).run();
  return res.meta.changes > 0;
}
async function reorderItems(db, category, order) {
  const upd = db.prepare('UPDATE items SET sort = ? WHERE category = ? AND id = ?');
  for (let i = 0; i < order.length; i++) await upd.bind(i, category, order[i]).run();
}
async function buildBackup(db) {
  return { exportedAt: new Date().toISOString(), ...(await getContent(db)) };
}
async function restore(db, backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw httpError(400, '备份格式错误');
  if (backup.profile !== undefined && (typeof backup.profile !== 'object' || backup.profile === null || Array.isArray(backup.profile))) throw httpError(400, '备份格式错误：profile');
  const normalized = {};
  for (const category of CATEGORIES) {
    const list = backup[category];
    if (list !== undefined && !Array.isArray(list)) throw httpError(400, `备份格式错误：${category}`);
    normalized[category] = list || [];
  }
  const now = new Date().toISOString();
  if (backup.profile !== undefined) await kvSet(db, 'profile_json', JSON.stringify(backup.profile));
  await db.prepare('DELETE FROM items').run();
  const ins = db.prepare('INSERT INTO items(id, category, sort, data, updated_at) VALUES(?, ?, ?, ?, ?)');
  const insAuto = db.prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)');
  for (const category of CATEGORIES) {
    normalized[category].forEach((item, i) => {
      const { id, ...data } = item;
      if (Number.isInteger(id)) ins.bind(id, category, i, JSON.stringify(data), now).run();
      else insAuto.bind(category, i, JSON.stringify(data), now).run();
    });
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/* ---------- 鉴权 ---------- */

async function getSessionSecret(db) {
  let secret = await kvGet(db, 'session_secret');
  if (!secret) {
    secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await kvSet(db, 'session_secret', secret);
  }
  return secret;
}

async function makeToken(db) {
  const payload = base64url(enc.encode(JSON.stringify({ exp: Date.now() + SEVEN_DAYS_MS })));
  const sig = await hmacHex(await getSessionSecret(db), payload);
  return `${payload}.${sig}`;
}

async function verifyToken(db, token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = await hmacHex(await getSessionSecret(db), payload);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const data = JSON.parse(dec.decode(b64uToBytes(payload)));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function setSessionCookie(c, token) {
  c.header('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SEVEN_DAYS_MS / 1000)}`);
}

/* ---------- 技术知识库（techNotes，与 lib/techNotes.js 双路径同构） ---------- */

async function getTechNotes(db) {
  const raw = await kvGet(db, TECH_NOTES_KV);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

// 有序事实文本（facts 顺序即五段式：定位/链路/算法/指标/难点/收获）
function noteFactsText(note) {
  if (!note) return '';
  const facts = Array.isArray(note.facts) ? note.facts : [];
  const parts = [];
  for (const f of facts) if (f && f.k && f.v) parts.push(`${f.k}：${f.v}`);
  return parts.join('；');
}

function buildTechNotesSection(notes) {
  const list = notes && typeof notes === 'object' && !Array.isArray(notes) ? Object.values(notes) : [];
  if (!list.length) return '';
  const lines = [
    '【项目技术要点】（口径说明：站点公开口径与简历一致；原始技术报告记录仅作附注，不在主回答中主动混用；数据仍在整理中的如实说明）'
  ];
  let i = 0;
  for (const n of list) {
    const label = (n && n.label) || (n && n.slug) || '';
    const contest = n && n.contest ? `（${n.contest}）` : '';
    const text = noteFactsText(n);
    if (!text) continue;
    i += 1;
    lines.push(`${i}. ${label}${contest}：${text}`);
  }
  return lines.join('\n');
}

// 离线兜底检索词条：与 collectEntries 同形状
function techNoteEntries(notes) {
  const list = notes && typeof notes === 'object' && !Array.isArray(notes) ? Object.values(notes) : [];
  const entries = [];
  for (const n of list) {
    const label = (n && n.label) || (n && n.slug) || '';
    if (!label) continue;
    const facts = Array.isArray(n.facts) ? n.facts : [];
    const pos = facts.find((f) => f && f.k === '定位');
    const contest = n.contest ? `（${n.contest}）` : '';
    entries.push({
      label: `项目技术要点 · ${label}`,
      summary: `${label}${contest}${pos && pos.v ? '：' + pos.v : ''}`,
      blob: flatten(n).toLowerCase(),
      aboutSelf: false
    });
  }
  return entries;
}

/* ---------- 对话(SSE) ---------- */

function buildSystemPrompt(content, extra, techNotes) {
  const rules = [
    '你是个人求职网站的 AI 助手，代表站主陆耀威本人与访客对话。请严格遵守：',
    '1. 以第一人称「我」回答，「我」就是陆耀威本人，语气克制自然、真实谦逊。',
    '2. 只依据下方「站点公开资料」回答，资料中没有的内容一律不编造。',
    '3. 站点公开资料之外的问题，或涉及隐私（手机号、住址、身份证、他人信息等）的问题，礼貌回避，并引导访客回到求职相关话题。',
    `4. 访客询问联系方式时，只提供邮箱：${SITE_EMAIL}。`,
    '5. 回答保持简洁，不堆砌资料。',
    '',
    '【站点公开资料】',
    serializeContent(content, techNotes)
  ];
  if (extra && extra.trim()) rules.push('', '【补充说明（站主配置）】', extra.trim());
  return rules.join('\n');
}

function serializeContent(content, techNotes) {
  const lines = [];
  const p = content.profile || {};
  lines.push('【个人简介】');
  lines.push(`姓名：${p.name || ''}；${p.intent || ''}；所在地：${p.location || ''}；政治面貌：${p.politics || ''}；邮箱：${p.email || ''}`);
  if (p.summary) lines.push(`个人总结：${p.summary}`);
  if (p.selfEval) lines.push(`自我评价：${p.selfEval}`);
  if (p.education) lines.push(`教育背景：${p.education.school || ''} ${p.education.major || ''}（${p.education.period || ''}），${p.education.gpa || ''}；主修课程：${p.education.courses || ''}`);
  if (Array.isArray(p.skills) && p.skills.length) lines.push(`技能：${p.skills.map((s) => `${s.group}：${s.items}`).join('；')}`);
  const techSection = buildTechNotesSection(techNotes);
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const items = content[category] || [];
    lines.push('', `【${CATEGORY_LABELS[category]}】`);
    if (!items.length) { lines.push('（暂无内容）'); } else { items.forEach((item, i) => lines.push(`${i + 1}. ${itemLine(category, item)}`)); }
    // v2 ⑦ 知识库：项目经历之后紧跟【项目技术要点】（口径：对外=站点/简历口径）
    if (category === 'projects' && techSection) lines.push('', techSection);
  }
  return lines.join('\n');
}

function itemLine(category, it) {
  const head = [];
  const parts = [];
  if (category === 'projects') {
    head.push(it.name);
    if (it.tag) head.push(it.tag);
    if (it.stack) parts.push(`技术：${it.stack}`);
    if (it.period) parts.push(`时间：${it.period}`);
    if (it.link) parts.push(`链接：${it.link}`);
    if (Array.isArray(it.bullets)) parts.push(`要点：${it.bullets.join('；')}`);
  } else if (category === 'progress') {
    head.push(it.project);
    if (it.status) parts.push(`状态：${it.status}`);
    if (it.note) parts.push(`说明：${it.note}`);
  } else if (category === 'campus') {
    head.push(it.title);
    if (it.org) head.push(it.org);
    if (it.period) parts.push(`时间：${it.period}`);
    if (it.detail) parts.push(`详情：${it.detail}`);
  } else if (category === 'honors') {
    head.push(it.name);
    if (it.year) head.push(it.year);
    if (it.detail) parts.push(`等级：${it.detail}`);
  } else if (category === 'internship') {
    head.push(it.company);
    if (it.role) head.push(it.role);
    if (it.dept) parts.push(`部门：${it.dept}`);
    if (it.period) parts.push(`时间：${it.period}`);
    if (Array.isArray(it.bullets)) parts.push(`要点：${it.bullets.join('；')}`);
  }
  return `${head.join(' · ')}${parts.length ? '：' + parts.join('；') : ''}`;
}

function collectEntries(content) {
  const entries = [];
  const p = content.profile || {};
  entries.push({ label: '个人简介', summary: `${p.name || ''}，${p.intent || ''}。${p.summary || ''}`, blob: flatten(p).toLowerCase(), aboutSelf: true });
  for (const category of Object.keys(CATEGORY_LABELS)) {
    for (const item of content[category] || []) {
      entries.push({ label: CATEGORY_LABELS[category], summary: itemLine(category, item), blob: flatten(item).toLowerCase(), aboutSelf: false });
    }
  }
  return entries;
}
function flatten(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  return Object.values(value).map(flatten).join(' ');
}
function tokenize(message) {
  const tokens = new Set();
  for (const m of message.toLowerCase().matchAll(/[a-z0-9+#]{2,}/g)) tokens.add(m[0]);
  for (const m of message.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) { tokens.add(run); continue; }
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens];
}
function buildOfflineAnswer(content, techNotes, message) {
  if (/(手机号|电话号码|住址|身份证|家庭住址|家人|父母)/.test(message)) {
    return `${OFFLINE_NOTE}\n抱歉，这类信息属于个人隐私，不方便在这里公开。如需联系我，请发送邮件至 ${SITE_EMAIL}。`;
  }
  if (/(联系|邮箱|邮件|email|电话|微信|qq|号码)/i.test(message)) {
    return `${OFFLINE_NOTE}\n如需联系我，请发送邮件至 ${SITE_EMAIL}，我会尽快回复。`;
  }
  const tokens = tokenize(message);
  const aboutSelf = /你|自己|您|介绍|简历|背景|经历/.test(message);
  // v2 ⑦：六类内容词条 + 技术报告知识库词条（让“分辨率 / FIR / 调制度 / 锁相 / 毫伏级”等词离线也可命中）
  const entries = collectEntries(content).concat(techNoteEntries(techNotes));
  const scored = entries
    .map((entry) => ({ entry, score: aboutSelf && entry.aboutSelf ? 99 : scoreBlob(entry.blob, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  if (!scored.length) {
    return `${OFFLINE_NOTE}\n抱歉，这个问题超出了站点公开资料的范围，我暂时无法回答。欢迎向我了解我的项目经历、获奖情况或实习经历；如需联系我，请发邮件至 ${SITE_EMAIL}。`;
  }
  const lines = scored.map((x) => `【${x.entry.label}】${truncate(x.entry.summary, 140)}`);
  return `${OFFLINE_NOTE}\n关于这个问题，站点公开资料中有这些相关内容：\n${lines.join('\n')}\n如需了解更多细节，欢迎继续提问；如需联系我，请发邮件至 ${SITE_EMAIL}。`;
}
function scoreBlob(blob, tokens) {
  let score = 0;
  for (const token of tokens) if (blob.includes(token)) score += token.length >= 2 ? 2 : 1;
  return score;
}
function truncate(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rateMap = new Map();
function allowRequest(ip) {
  const now = Date.now();
  if (rateMap.size > 1000) for (const [key, rec] of rateMap) if (now - rec.start >= 60000) rateMap.delete(key);
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start >= 60000) { rateMap.set(ip, { count: 1, start: now }); return true; }
  rec.count += 1;
  return rec.count <= 20;
}

function sseResponse(streamFn) {
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch (e) {} };
      const done = () => { try { controller.enqueue(enc.encode('data: [DONE]\n\n')); } catch (e) {} try { controller.close(); } catch (e) {} };
      streamFn(send, done);
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }
  });
}

async function streamFromAgent(content, techNotes, message, history, apiKey, baseUrl, model, extra, send, done) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(content, extra, techNotes) },
    ...history,
    { role: 'user', content: message }
  ];
  let resp;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: true, messages })
    });
  } catch (e) {
    send({ error: '无法连接 AI 服务' });
    done();
    return;
  }
  if (!resp.ok || !resp.body) { send({ error: `AI 服务返回 ${resp.status}` }); done(); return; }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done: rd, value } = await reader.read();
      if (rd) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { done(); return; }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) send({ delta });
        } catch (e) {}
      }
    }
  } catch (e) {}
  done();
}

async function streamOffline(content, techNotes, message, send, done) {
  const text = buildOfflineAnswer(content, techNotes, message);
  for (let i = 0; i < text.length; i += 60) {
    send({ delta: text.slice(i, i + 60) });
    await sleep(30);
  }
  done();
}

/* ---------- 路由 ---------- */

const app = new Hono();

app.get('/api/auth/state', async (c) => {
  const db = c.env.DB;
  const pass = await kvGet(db, 'password_hash');
  const authed = await verifyToken(db, parseCookies(c.req.raw)[COOKIE_NAME]);
  return c.json({ setupNeeded: !pass, authenticated: authed });
});

app.post('/api/auth/setup', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const password = body.password;
  if (typeof password !== 'string' || password.length < 6) return c.json({ error: '密码至少 6 位' }, 400);
  if (await kvGet(db, 'password_hash')) return c.json({ error: '密码已设置，请直接登录' }, 400);
  await kvSet(db, 'password_hash', await hashPassword(password));
  setSessionCookie(c, await makeToken(db));
  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const stored = await kvGet(db, 'password_hash');
  if (!stored || typeof body.password !== 'string' || !(await verifyPassword(body.password, stored))) {
    return c.json({ error: '密码错误' }, 401);
  }
  setSessionCookie(c, await makeToken(db));
  return c.json({ ok: true });
});

app.post('/api/auth/logout', (c) => {
  c.header('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return c.json({ ok: true });
});

app.get('/api/content', async (c) => c.json(await getContent(c.env.DB)));

app.post('/api/chat', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  if (!allowRequest(ip)) return c.json({ error: '请求过于频繁，请稍后再试' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return c.json({ error: 'message 不能为空' }, 400);
  const history = Array.isArray(body.history)
    ? body.history.filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant')).slice(-12)
    : [];
  const db = c.env.DB;
  const content = await getContent(db);
  const techNotes = await getTechNotes(db);
  const apiKey = (await kvGet(db, 'agent_api_key')) || c.env.AGENT_API_KEY || '';
  const baseUrl = ((await kvGet(db, 'agent_base_url')) || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = (await kvGet(db, 'agent_model')) || DEFAULT_MODEL;
  const extra = (await kvGet(db, 'system_prompt_extra')) || '';
  return sseResponse((send, done) => {
    if (apiKey) streamFromAgent(content, techNotes, message, history, apiKey, baseUrl, model, extra, send, done);
    else streamOffline(content, techNotes, message, send, done);
  });
});

const requireAuth = () => async (c, next) => {
  const ok = await verifyToken(c.env.DB, parseCookies(c.req.raw)[COOKIE_NAME]);
  if (!ok) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

app.get('/api/admin/content', requireAuth(), async (c) => c.json(await getContent(c.env.DB)));

app.put('/api/admin/profile', requireAuth(), async (c) => {
  const profile = await c.req.json().catch(() => null);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return c.json({ error: 'profile 必须是对象' }, 400);
  await kvSet(c.env.DB, 'profile_json', JSON.stringify(profile));
  return c.json({ ok: true, profile });
});

app.get('/api/admin/settings', requireAuth(), async (c) => {
  const db = c.env.DB;
  const key = (await kvGet(db, 'agent_api_key')) || c.env.AGENT_API_KEY || '';
  return c.json({
    agentBaseUrl: (await kvGet(db, 'agent_base_url')) || DEFAULT_BASE_URL,
    agentModel: (await kvGet(db, 'agent_model')) || DEFAULT_MODEL,
    agentApiKeySet: Boolean(key),
    agentApiKeyMasked: key ? (key.length <= 8 ? '***' : `${key.slice(0, 3)}***${key.slice(-4)}`) : '',
    systemPromptExtra: (await kvGet(db, 'system_prompt_extra')) || ''
  });
});

app.put('/api/admin/settings', requireAuth(), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: '请求体必须是对象' }, 400);
  if (typeof body.agentBaseUrl === 'string') await kvSet(db, 'agent_base_url', body.agentBaseUrl.trim());
  if (typeof body.agentModel === 'string') await kvSet(db, 'agent_model', body.agentModel.trim());
  if (typeof body.systemPromptExtra === 'string') await kvSet(db, 'system_prompt_extra', body.systemPromptExtra);
  if (body.clearApiKey === true) await kvDel(db, 'agent_api_key');
  else if (typeof body.agentApiKey === 'string' && body.agentApiKey.trim()) await kvSet(db, 'agent_api_key', body.agentApiKey.trim());
  const key = (await kvGet(db, 'agent_api_key')) || c.env.AGENT_API_KEY || '';
  return c.json({
    agentBaseUrl: (await kvGet(db, 'agent_base_url')) || DEFAULT_BASE_URL,
    agentModel: (await kvGet(db, 'agent_model')) || DEFAULT_MODEL,
    agentApiKeySet: Boolean(key),
    agentApiKeyMasked: key ? (key.length <= 8 ? '***' : `${key.slice(0, 3)}***${key.slice(-4)}`) : '',
    systemPromptExtra: (await kvGet(db, 'system_prompt_extra')) || ''
  });
});

app.get('/api/admin/backup', requireAuth(), async (c) => {
  const backup = await buildBackup(c.env.DB);
  return new Response(JSON.stringify(backup), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="content-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json"` }
  });
});

app.post('/api/admin/restore', requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null);
  try {
    await restore(c.env.DB, body);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e.expose ? e.message : '恢复失败' }, e.status || 400);
  }
});

const uploadStub = requireAuth();
app.post('/api/admin/upload', uploadStub, (c) => c.json({ error: '在线版暂不支持图片上传（可接入 R2 后启用）' }, 501));
app.delete('/api/admin/upload', uploadStub, (c) => c.json({ error: '在线版暂不支持图片上传（可接入 R2 后启用）' }, 501));

app.post('/api/admin/:category', requireAuth(), async (c) => {
  const category = c.req.param('category');
  if (!CATEGORIES.includes(category)) return c.json({ error: '非法分类' }, 400);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: '请求体必须是 item 对象' }, 400);
  const item = await insertItem(c.env.DB, category, body);
  return c.json(item, 201);
});

app.put('/api/admin/:category/order', requireAuth(), async (c) => {
  const category = c.req.param('category');
  if (!CATEGORIES.includes(category)) return c.json({ error: '非法分类' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const order = body.order;
  if (!Array.isArray(order) || !order.every(Number.isInteger)) return c.json({ error: 'order 必须是 id 数组' }, 400);
  await reorderItems(c.env.DB, category, order);
  return c.json({ ok: true });
});

app.put('/api/admin/:category/:id', requireAuth(), async (c) => {
  const category = c.req.param('category');
  if (!CATEGORIES.includes(category)) return c.json({ error: '非法分类' }, 400);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'item 不存在' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: '请求体必须是 item 对象' }, 400);
  if (!(await updateItem(c.env.DB, category, id, body))) return c.json({ error: 'item 不存在' }, 404);
  return c.json({ ...body, id });
});

app.delete('/api/admin/:category/:id', requireAuth(), async (c) => {
  const category = c.req.param('category');
  if (!CATEGORIES.includes(category)) return c.json({ error: '非法分类' }, 400);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || !(await deleteItem(c.env.DB, category, id))) return c.json({ error: 'item 不存在' }, 404);
  return c.json({ ok: true });
});

/* project docs(与 Node 版一致:seed 有 projectDocs 可用;未命中时合成骨架文档) */
app.get('/api/project/:slug', async (c) => {
  const doc = await getProjectDocOrSkeleton(c.env.DB, c.req.param('slug'));
  if (!doc) return c.json({ error: 'not found' }, 404);
  return c.json(doc);
});

/* 其余请求交给静态资源(public/):Assets 自动按无扩展路径服务(/ 与 /admin);/p/:slug 映射到 detail */
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  if (path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
  if (path.startsWith('/p/')) {
    return c.env.ASSETS.fetch(new Request(new URL('/detail', url.origin), c.req.raw));
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  async fetch(request, env, ctx) {
    await ensureSchema(env.DB);
    return app.fetch(request, env, ctx);
  }
};
