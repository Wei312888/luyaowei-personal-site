const { Readable } = require('node:stream');
const express = require('express');
const { CATEGORIES, kvGet } = require('./db');
const { getContent } = require('./content');
const { getTechNotes, buildTechNotesSection, techNoteEntries } = require('./techNotes');
const { httpError } = require('./errors');

const CATEGORY_LABELS = {
  projects: '项目经历',
  progress: '项目进展',
  campus: '校园经历',
  honors: '获奖情况',
  internship: '实习经历'
};
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 60 * 1000;
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const SITE_EMAIL = 'luyaowei9930@163.com';
const OFFLINE_NOTE = '（AI 尚未接入，以下基于站点公开资料自动整理）';

function chatRouter(db) {
  const router = express.Router();
  const rateMap = new Map();
  router.post('/chat', (req, res) => {
    if (!allowRequest(rateMap, req.ip)) return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw httpError(400, 'message 不能为空');
    const history = Array.isArray(body.history)
      ? body.history
          .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
          .slice(-12)
      : [];
    startChat(db, res, message, history);
  });
  return router;
}

function allowRequest(rateMap, ip) {
  const now = Date.now();
  if (rateMap.size > 1000) {
    for (const [key, rec] of rateMap) if (now - rec.start >= RATE_WINDOW_MS) rateMap.delete(key);
  }
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start >= RATE_WINDOW_MS) {
    rateMap.set(ip, { count: 1, start: now });
    return true;
  }
  rec.count += 1;
  return rec.count <= RATE_LIMIT;
}

async function startChat(db, res, message, history) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  let closed = false;
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      closed = true;
      controller.abort();
    }
  });
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const send = (obj) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      closed = true;
    }
  };
  const finish = () => {
    clearTimeout(timer);
    if (!res.writableEnded) {
      if (!closed) {
        try {
          res.write('data: [DONE]\n\n');
        } catch {
          /* 客户端已断开 */
        }
      }
      res.end();
    }
  };

  try {
    const content = getContent(db);
    // 技术报告知识库（kv techNotes_json，seed 蒸馏条目；无则空对象，双路径同构）
    const techNotes = getTechNotes(db);
    const apiKey = kvGet(db, 'agent_api_key') || process.env.AGENT_API_KEY || '';
    if (apiKey) await streamFromAgent(db, content, techNotes, message, history, apiKey, controller, send, finish, () => closed);
    else await streamOffline(content, techNotes, message, send, finish, () => closed);
  } catch (e) {
    if (!closed) send({ error: e instanceof Error && e.name === 'AbortError' ? '请求 AI 服务超时' : '对话服务出现错误，请稍后再试' });
    finish();
  }
}

async function streamFromAgent(db, content, techNotes, message, history, apiKey, controller, send, finish, isClosed) {
  const baseUrl = (kvGet(db, 'agent_base_url') || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = kvGet(db, 'agent_model') || DEFAULT_MODEL;
  const extra = kvGet(db, 'system_prompt_extra') || '';
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
      body: JSON.stringify({ model, stream: true, messages }),
      signal: controller.signal
    });
  } catch (e) {
    if (isClosed()) {
      finish();
      return;
    }
    throw new Error('无法连接 AI 服务');
  }
  if (!resp.ok || !resp.body) throw new Error(`AI 服务返回 ${resp.status}`);

  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of Readable.fromWeb(resp.body)) {
    if (isClosed()) break;
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        finish();
        return;
      }
      try {
        const json = JSON.parse(payload);
        const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
        if (delta) send({ delta });
      } catch {
        // 上游偶发的非 JSON 行直接忽略
      }
    }
  }
  finish();
}

async function streamOffline(content, techNotes, message, send, finish, isClosed) {
  const text = buildOfflineAnswer(content, techNotes, message);
  for (let i = 0; i < text.length; i += 60) {
    if (isClosed()) {
      finish();
      return;
    }
    send({ delta: text.slice(i, i + 60) });
    await sleep(30);
  }
  finish();
}

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
  if (extra.trim()) rules.push('', '【补充说明（站主配置）】', extra.trim());
  return rules.join('\n');
}

function serializeContent(content, techNotes) {
  const lines = [];
  const p = content.profile || {};
  lines.push('【个人简介】');
  lines.push(
    `姓名：${p.name || ''}；${p.intent || ''}；所在地：${p.location || ''}；政治面貌：${p.politics || ''}；邮箱：${p.email || ''}`
  );
  if (p.summary) lines.push(`个人总结：${p.summary}`);
  if (p.selfEval) lines.push(`自我评价：${p.selfEval}`);
  if (p.education) {
    lines.push(
      `教育背景：${p.education.school || ''} ${p.education.major || ''}（${p.education.period || ''}），${p.education.gpa || ''}；主修课程：${p.education.courses || ''}`
    );
  }
  if (Array.isArray(p.skills) && p.skills.length) {
    lines.push(`技能：${p.skills.map((s) => `${s.group}：${s.items}`).join('；')}`);
  }
  const techSection = buildTechNotesSection(techNotes);
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const items = content[category] || [];
    lines.push('', `【${CATEGORY_LABELS[category]}】`);
    if (!items.length) {
      lines.push('（暂无内容）');
    } else {
      items.forEach((item, i) => lines.push(`${i + 1}. ${itemLine(category, item)}`));
    }
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

function collectEntries(content) {
  const entries = [];
  const p = content.profile || {};
  entries.push({
    label: '个人简介',
    summary: `${p.name || ''}，${p.intent || ''}。${p.summary || ''}`,
    blob: flatten(p).toLowerCase(),
    aboutSelf: true
  });
  for (const category of Object.keys(CATEGORY_LABELS)) {
    for (const item of content[category] || []) {
      entries.push({
        label: CATEGORY_LABELS[category],
        summary: itemLine(category, item),
        blob: flatten(item).toLowerCase(),
        aboutSelf: false
      });
    }
  }
  return entries;
}

function tokenize(message) {
  const tokens = new Set();
  for (const m of message.toLowerCase().matchAll(/[a-z0-9+#]{2,}/g)) tokens.add(m[0]);
  // 中文按二元组切词，与内容词条做子串匹配
  for (const m of message.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens];
}

function scoreBlob(blob, tokens) {
  let score = 0;
  for (const token of tokens) if (blob.includes(token)) score += token.length >= 2 ? 2 : 1;
  return score;
}

function flatten(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  return Object.values(value).map(flatten).join(' ');
}

function truncate(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { chatRouter, buildSystemPrompt, buildOfflineAnswer, CATEGORIES };
