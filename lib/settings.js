const { kvGet, kvSet, kvDel } = require('./db');
const { httpError } = require('./errors');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

// 任何接口不得返回完整 key，只给掩码
function maskKey(key) {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

function getSettings(db) {
  // 优先数据库配置,其次部署环境变量(免费托管如 Render 用 AGENT_API_KEY 注入,避免丢失/明文入库)
  const key = kvGet(db, 'agent_api_key') || process.env.AGENT_API_KEY || '';
  return {
    agentBaseUrl: kvGet(db, 'agent_base_url') || DEFAULT_BASE_URL,
    agentModel: kvGet(db, 'agent_model') || DEFAULT_MODEL,
    agentApiKeySet: Boolean(key),
    agentApiKeyMasked: key ? maskKey(key) : '',
    systemPromptExtra: kvGet(db, 'system_prompt_extra') || ''
  };
}

function putSettings(db, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, '请求体必须是对象');
  if (typeof body.agentBaseUrl === 'string') kvSet(db, 'agent_base_url', body.agentBaseUrl.trim());
  if (typeof body.agentModel === 'string') kvSet(db, 'agent_model', body.agentModel.trim());
  if (typeof body.systemPromptExtra === 'string') kvSet(db, 'system_prompt_extra', body.systemPromptExtra);
  if (body.clearApiKey === true) kvDel(db, 'agent_api_key');
  else if (typeof body.agentApiKey === 'string' && body.agentApiKey.trim()) kvSet(db, 'agent_api_key', body.agentApiKey.trim());
  return getSettings(db);
}

module.exports = { getSettings, putSettings };
