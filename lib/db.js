const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const CATEGORIES = ['projects', 'progress', 'campus', 'honors', 'internship'];
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
  // 2) projectDocs：kv 缺失时写入，供 /api/project/:slug 读取
  const hasDocs = db.prepare('SELECT value FROM kv WHERE key = ?').get('projectDocs_json');
  if (!hasDocs && seed.projectDocs && typeof seed.projectDocs === 'object') {
    kvSet(db, 'projectDocs_json', JSON.stringify(seed.projectDocs));
  }
  // 3) internship modules：已有条目缺 modules 时从 seed 注入（幂等，不改既有字段/密码）
  migrateInternshipModules(db, seed);
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

module.exports = { CATEGORIES, DATA_DIR, initDb, kvGet, kvSet, kvDel };
