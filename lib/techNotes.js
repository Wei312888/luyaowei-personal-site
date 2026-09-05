/* 技术报告知识库（techNotes）· Node 路径模块
   数据形态：kv.techNotes_json = { <slug>: { slug, label, contest, note, facts:[{k,v}] } }
   导入：lib/db.js migrate 从 seed.content-seed.json 的 techNotes 增量写入（幂等）；
   消费：lib/chat.js —— ① system prompt【项目技术要点】节（buildTechNotesSection）；
        ② 离线兜底检索词条（techNoteEntries），让“分辨率/FIR/调制度/锁相”等词可命中。
   口径纪律：对外 = 站点/简历口径（techNotes 已按简历口径蒸馏）；原始报告仅作附注，不在主句中混用。 */
const { kvGet } = require('./db');

const TECH_NOTES_KV = 'techNotes_json';

function getTechNotes(db) {
  const raw = kvGet(db, TECH_NOTES_KV);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function getTechNote(db, slug) {
  return getTechNotes(db)[slug] || null;
}

// 有序事实文本（facts 顺序即五段式：定位/链路/算法/指标/难点/收获）
function noteFactsText(note) {
  if (!note) return '';
  const facts = Array.isArray(note.facts) ? note.facts : [];
  const parts = [];
  for (const f of facts) {
    if (f && f.k && f.v) parts.push(`${f.k}：${f.v}`);
  }
  return parts.join('；');
}

// system prompt 用：【项目技术要点】整节正文（含口径说明；无条目时返回空串）
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

// 离线兜底检索词条：与 chat.js collectEntries 同形状
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

function flatten(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  return Object.values(value)
    .map(flatten)
    .join(' ');
}

module.exports = { TECH_NOTES_KV, getTechNotes, getTechNote, noteFactsText, buildTechNotesSection, techNoteEntries };
