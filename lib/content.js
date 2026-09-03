const { CATEGORIES, kvGet, kvSet } = require('./db');
const { httpError } = require('./errors');

const PROJECT_DOCS_KV = 'projectDocs_json';

function listCategory(db, category) {
  return db
    .prepare('SELECT id, data FROM items WHERE category = ? ORDER BY sort ASC, id ASC')
    .all(category)
    .map((row) => ({ ...JSON.parse(row.data), id: Number(row.id) }));
}

function getContent(db) {
  const profileRaw = kvGet(db, 'profile_json');
  const content = { profile: profileRaw ? JSON.parse(profileRaw) : {} };
  for (const category of CATEGORIES) content[category] = listCategory(db, category);
  return content;
}

// projectDocs：以 slug 为键的深度项目文档集合，存储在 kv.projectDocs_json
function getProjectDocs(db) {
  const raw = kvGet(db, PROJECT_DOCS_KV);
  return raw ? JSON.parse(raw) : {};
}

function getProjectDoc(db, slug) {
  const docs = getProjectDocs(db);
  return (docs && docs[slug]) || null;
}


function insertItem(db, category, body) {
  const { id, ...data } = body;
  const sort = db.prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS s FROM items WHERE category = ?').get(category).s;
  const result = db
    .prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)')
    .run(category, sort, JSON.stringify(data), new Date().toISOString());
  return { ...data, id: Number(result.lastInsertRowid) };
}

function updateItem(db, category, id, body) {
  const { id: ignored, ...data } = body;
  const result = db
    .prepare('UPDATE items SET data = ?, updated_at = ? WHERE category = ? AND id = ?')
    .run(JSON.stringify(data), new Date().toISOString(), category, id);
  return result.changes > 0;
}

function deleteItem(db, category, id) {
  return db.prepare('DELETE FROM items WHERE category = ? AND id = ?').run(category, id).changes > 0;
}

function reorderItems(db, category, order) {
  const upd = db.prepare('UPDATE items SET sort = ? WHERE category = ? AND id = ?');
  order.forEach((id, i) => upd.run(i, category, id));
}

function buildBackup(db) {
  return { exportedAt: new Date().toISOString(), ...getContent(db) };
}

function restore(db, backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw httpError(400, '备份格式错误');
  if (backup.profile !== undefined && (typeof backup.profile !== 'object' || backup.profile === null || Array.isArray(backup.profile))) {
    throw httpError(400, '备份格式错误：profile');
  }
  const normalized = {};
  for (const category of CATEGORIES) {
    const list = backup[category];
    if (list !== undefined && !Array.isArray(list)) throw httpError(400, `备份格式错误：${category}`);
    normalized[category] = list || [];
  }
  const insertWithId = db.prepare('INSERT INTO items(id, category, sort, data, updated_at) VALUES(?, ?, ?, ?, ?)');
  const insertAuto = db.prepare('INSERT INTO items(category, sort, data, updated_at) VALUES(?, ?, ?, ?)');
  const usedIds = new Set(
    CATEGORIES.flatMap((c) => normalized[c]).map((it) => it.id).filter(Number.isInteger)
  );
  const duplicateIds = usedIds.size !== CATEGORIES.flatMap((c) => normalized[c]).filter((it) => Number.isInteger(it.id)).length;
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    if (backup.profile !== undefined) kvSet(db, 'profile_json', JSON.stringify(backup.profile));
    db.prepare('DELETE FROM items').run();
    for (const category of CATEGORIES) {
      normalized[category].forEach((item, i) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw httpError(400, `备份格式错误：${category}`);
        const { id, ...data } = item;
        // 备份内 id 重复时退回自增分配，保证恢复总能成功
        if (Number.isInteger(id) && !duplicateIds) insertWithId.run(id, category, i, JSON.stringify(data), now);
        else insertAuto.run(category, i, JSON.stringify(data), now);
      });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { listCategory, getContent, getProjectDocs, getProjectDoc, insertItem, updateItem, deleteItem, reorderItems, buildBackup, restore };
