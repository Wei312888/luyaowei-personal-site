const { CATEGORIES, PROJECT_SLUG_BY_NAME, kvGet, kvSet } = require('./db');
const { httpError } = require('./errors');

const PROJECT_DOCS_KV = 'projectDocs_json';
// 管理端表单不编辑的 v2 元字段：整体替换保存时若请求体缺这些键，沿用库里旧值（防误删）
const PROJECT_META_PRESERVE = ['slug', 'tier', 'line', 'param'];

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
  // 快捷问题（v2）：seed 维护的站点配置，kv 缺失时前端用内置默认值兜底
  const quickRaw = kvGet(db, 'quick_questions_json');
  if (quickRaw) {
    try {
      const quick = JSON.parse(quickRaw);
      if (Array.isArray(quick) && quick.length) content.quickQuestions = quick;
    } catch (e) {
      /* 解析失败则不下发，前端走默认值 */
    }
  }
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

// 详情文档解析:优先 projectDocs;其次 seed 中的完整文档(旧库 projectDocs_json 可能
// 缺 3 个硬件项目——种子回退保证部署/升级后自动补全,无需手工迁移 kv);
// 仍未命中则在项目列表内按 slug(含名称兜底映射)合成骨架;完全未命中返回 null
const SEED = require('../seed/content-seed.json');

function getProjectDocOrSkeleton(db, slug) {
  const doc = getProjectDoc(db, slug);
  if (doc) return doc;
  const seedDoc = SEED.projectDocs && SEED.projectDocs[slug];
  if (seedDoc) return seedDoc;
  const project = listCategory(db, 'projects').find(
    (it) =>
      (it.slug && it.slug === slug) ||
      (PROJECT_SLUG_BY_NAME[it.name] === slug) ||
      (it.id !== undefined && slug === `p-${it.id}`)
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
  if (category === 'projects') {
    // 管理端表单只回传其声明的字段：保留 v2 元字段与 slug（请求体缺键时沿用库值，避免误删）
    const row = db.prepare('SELECT data FROM items WHERE category = ? AND id = ?').get(category, id);
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

module.exports = { listCategory, getContent, getProjectDocs, getProjectDoc, getProjectDocOrSkeleton, insertItem, updateItem, deleteItem, reorderItems, buildBackup, restore };
