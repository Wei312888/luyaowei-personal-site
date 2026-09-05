const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const CATEGORIES = ['projects', 'progress', 'campus', 'honors', 'internship'];
// 项目 slug 兜底映射:按名称精确匹配(与 seed 保持一致),迁移与运行时查找共用
const PROJECT_SLUG_BY_NAME = {
  'EDA Agent 桥（嘉立创 EDA 扩展 + 网关 + MCP）': 'eda-agent-bridge',
  'wei+ 嵌入式信号串口助手': 'wei-plus',
  '周期信号测量分析装置（简易示波器）': 'signal-measurement-device',
  '模拟信号无线收发机': 'wireless-transceiver',
  '宽带混合信号分离与锁相重建系统': 'broadband-signal-separation'
};
// DATA_DIR 可被环境变量覆盖（如部署时指向持久磁盘），默认项目内 data/
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'site.db');
const SEED_FILE = path.join(__dirname, '..', 'seed', 'content-seed.json');

function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // 仅当内容完全为空时才导入种子，避免覆盖已有数据
  const empty =
    db.prepare('SELECT COUNT(*) AS n FROM items').get().n === 0 &&
    !db.prepare('SELECT value FROM kv WHERE key = ?').get('profile_json');
  if (empty) importSeed(db);
  // 已有库做增量迁移：补 campus 与 projectDocs，绝不动管理密码/设置
  migrate(db);
  return db;
}

function importSeed(db) {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO kv(key, value) VALUES(?, ?)').run('profile_json', JSON.stringify(seed.profile));
    // items.id 是全表自增主键，seed 里各分类 id 均从 1 起，按数组顺序插入即可
    const ins = db.prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)');
    for (const category of CATEGORIES) {
      (seed[category] || []).forEach((item, i) => {
        const { id, ...data } = item;
        ins.run(category, i, JSON.stringify(data), now);
      });
    }
    if (seed.projectDocs && typeof seed.projectDocs === 'object') {
      kvSet(db, 'projectDocs_json', JSON.stringify(seed.projectDocs));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// 增量迁移：仅针对已有库补全新字段，幂等，且不触碰 password_hash / agent_* 等设置
function migrate(db) {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const now = new Date().toISOString();
  // 1) campus：原本为空时插入 seed 中的校园条目，避免覆盖其它分类已有数据
  const campusEmpty = db.prepare('SELECT COUNT(*) AS n FROM items WHERE category = ?').get('campus').n === 0;
  if (campusEmpty && Array.isArray(seed.campus) && seed.campus.length) {
    const ins = db.prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)');
    db.exec('BEGIN');
    try {
      seed.campus.forEach((item, i) => {
        const { id, ...data } = item;
        ins.run('campus', i, JSON.stringify(data), now);
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  // 2) projectDocs：kv 缺失时写入，供 /api/project/:slug 读取；已有库仅合并 seed 中缺失的 slug（不动既有文档，幂等）
  const docsRaw = db.prepare('SELECT value FROM kv WHERE key = ?').get('projectDocs_json');
  if (!docsRaw && seed.projectDocs && typeof seed.projectDocs === 'object') {
    kvSet(db, 'projectDocs_json', JSON.stringify(seed.projectDocs));
  } else if (docsRaw && seed.projectDocs && typeof seed.projectDocs === 'object') {
    try {
      const existing = JSON.parse(docsRaw.value);
      let changed = false;
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        for (const slug of Object.keys(seed.projectDocs)) {
          if (existing[slug] === undefined) {
            existing[slug] = seed.projectDocs[slug];
            changed = true;
          }
        }
        if (changed) kvSet(db, 'projectDocs_json', JSON.stringify(existing));
      }
    } catch (e) {
      // 既有 kv 解析失败：不覆盖（保持现状，避免破坏数据）
    }
  }
  // 2b) techNotes：知识库 kv 缺失或缺 slug 时从 seed 合并写入（幂等，不动既有条目）
  migrateTechNotes(db, seed);
  // 2c) quickQuestions：快捷问题 kv 缺失时写入（站点配置性数据，仅 seed 维护）
  const hasQuick = db.prepare('SELECT value FROM kv WHERE key = ?').get('quick_questions_json');
  if (!hasQuick && Array.isArray(seed.quickQuestions) && seed.quickQuestions.length) {
    kvSet(db, 'quick_questions_json', JSON.stringify(seed.quickQuestions));
  }
  // 2d) projects v2 元字段：slug 命中 seed 时补 tier/line/param/period（仅字段缺失/为空时，幂等）
  migrateProjectMeta(db, seed);
  // 3) internship modules：已有条目缺 modules 时从 seed 注入（幂等，不改既有字段/密码）
  migrateInternshipModules(db, seed);
  // 4) projects slug：缺失时按已知名称映射补全，未知名称用 p-<id> 兜底（幂等）
  migrateProjectSlugs(db);
}

// 知识库 techNotes：已有 kv 只补缺失 slug（seed 增条目后旧库可平滑升级），无 kv 则整包写入
function migrateTechNotes(db, seed) {
  const notes = seed.techNotes;
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return;
  const raw = db.prepare('SELECT value FROM kv WHERE key = ?').get('techNotes_json');
  if (!raw) {
    kvSet(db, 'techNotes_json', JSON.stringify(notes));
    return;
  }
  try {
    const existing = JSON.parse(raw.value);
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      kvSet(db, 'techNotes_json', JSON.stringify(notes));
      return;
    }
    let changed = false;
    for (const slug of Object.keys(notes)) {
      if (existing[slug] === undefined) {
        existing[slug] = notes[slug];
        changed = true;
      }
    }
    if (changed) kvSet(db, 'techNotes_json', JSON.stringify(existing));
  } catch (e) {
    kvSet(db, 'techNotes_json', JSON.stringify(notes));
  }
}

// 项目 v2 元字段（tier/line/param/period）：按 slug 匹配 seed，仅当字段缺失或为空时补全（幂等；
// period 对硬件三项目为简历口径必填值；tier 驱动字重与排序展示）
function migrateProjectMeta(db, seed) {
  const seedBySlug = {};
  for (const it of Array.isArray(seed.projects) ? seed.projects : []) {
    if (it && it.slug) seedBySlug[it.slug] = it;
  }
  if (!Object.keys(seedBySlug).length) return;
  const rows = db.prepare("SELECT id, data FROM items WHERE category = 'projects' ORDER BY sort ASC, id ASC").all();
  const upd = db.prepare('UPDATE items SET data = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
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
    if (changed) upd.run(JSON.stringify(data), now, row.id);
  }
}

// 仅为项目条目补 slug 字段:保留全部既有字段,只新增 slug(幂等,已存在则跳过)
function migrateProjectSlugs(db) {
  const rows = db.prepare("SELECT id, data FROM items WHERE category = 'projects' ORDER BY sort ASC, id ASC").all();
  const upd = db.prepare('UPDATE items SET data = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    if (data.slug && String(data.slug).trim()) continue;
    const slug = PROJECT_SLUG_BY_NAME[data.name] || `p-${row.id}`;
    upd.run(JSON.stringify({ ...data, slug }), now, row.id);
  }
}

// 仅为已有 internship 条目补 modules/takeaway：保留全部既有字段，只新增/覆盖这两个键；幂等（已有 modules 则跳过）
function migrateInternshipModules(db, seed) {
  const seedInterns = Array.isArray(seed.internship) ? seed.internship : [];
  const target = seedInterns.find((it) => it && Array.isArray(it.modules) && it.modules.length && it.takeaway);
  if (!target) return;
  const rows = db.prepare("SELECT id, data FROM items WHERE category = 'internship' ORDER BY sort ASC, id ASC").all();
  const candidates = [];
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    if (Array.isArray(data.modules)) continue; // 已迁移，跳过
    candidates.push({ id: row.id, data });
  }
  if (!candidates.length) return;
  // 优先匹配 company 相同者；否则更新所有缺 modules 的 internship（当前数据仅一条实习）
  const byCompany = candidates.filter((c) => c.data.company === target.company);
  const toUpdate = byCompany.length ? byCompany : candidates;
  const now = new Date().toISOString();
  const upd = db.prepare('UPDATE items SET data = ?, updated_at = ? WHERE id = ?');
  for (const { id, data } of toUpdate) {
    upd.run(JSON.stringify({ ...data, modules: target.modules, takeaway: target.takeaway }), now, id);
  }
}

function kvGet(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? row.value : null;
}

function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function kvDel(db, key) {
  db.prepare('DELETE FROM kv WHERE key = ?').run(key);
}

module.exports = { CATEGORIES, PROJECT_SLUG_BY_NAME, DATA_DIR, initDb, kvGet, kvSet, kvDel };
