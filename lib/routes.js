const express = require('express');
const { CATEGORIES, kvSet } = require('./db');
const {
  getContent,
  getProjectDoc,
  insertItem,
  updateItem,
  deleteItem,
  reorderItems,
  buildBackup,
  restore
} = require('./content');
const { authRouter, requireAuth } = require('./auth');
const { getSettings, putSettings } = require('./settings');
const { chatRouter } = require('./chat');
const { uploadRouter } = require('./uploads');
const { httpError } = require('./errors');

function createApiRouter(db) {
  const api = express.Router();

  api.use('/auth', authRouter(db));
  api.get('/content', (req, res) => res.json(getContent(db)));
  // 项目深度文档（公开，供 /p/:slug 详情页按 slug 渲染）
  api.get('/project/:slug', (req, res) => {
    const doc = getProjectDoc(db, req.params.slug);
    if (!doc) throw httpError(404, '项目文档不存在');
    res.json(doc);
  });
  api.use('/admin', requireAuth(db));
  api.use('/admin', uploadRouter());

  api.get('/admin/content', (req, res) => res.json(getContent(db)));

  api.put('/admin/profile', (req, res) => {
    const profile = req.body;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw httpError(400, 'profile 必须是对象');
    kvSet(db, 'profile_json', JSON.stringify(profile));
    res.json({ ok: true, profile });
  });

  api.get('/admin/settings', (req, res) => res.json(getSettings(db)));
  api.put('/admin/settings', (req, res) => res.json(putSettings(db, req.body)));

  api.get('/admin/backup', (req, res) => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="content-backup-${stamp}.json"`);
    res.json(buildBackup(db));
  });

  api.post('/admin/restore', (req, res) => {
    restore(db, req.body);
    res.json({ ok: true });
  });

  api.post('/admin/:category', (req, res) => {
    const category = checkCategory(req.params.category);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, '请求体必须是 item 对象');
    res.status(201).json(insertItem(db, category, body));
  });

  api.put('/admin/:category/order', (req, res) => {
    const category = checkCategory(req.params.category);
    const order = req.body && req.body.order;
    if (!Array.isArray(order) || !order.every(Number.isInteger)) throw httpError(400, 'order 必须是 id 数组');
    reorderItems(db, category, order);
    res.json({ ok: true });
  });

  api.put('/admin/:category/:id', (req, res) => {
    const category = checkCategory(req.params.category);
    const id = toId(req.params.id);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, '请求体必须是 item 对象');
    if (!updateItem(db, category, id, body)) throw httpError(404, 'item 不存在');
    res.json({ ...body, id });
  });

  api.delete('/admin/:category/:id', (req, res) => {
    const category = checkCategory(req.params.category);
    if (!deleteItem(db, category, toId(req.params.id))) throw httpError(404, 'item 不存在');
    res.json({ ok: true });
  });

  api.use(chatRouter(db));
  return api;
}

function checkCategory(category) {
  if (!CATEGORIES.includes(category)) throw httpError(400, '非法分类');
  return category;
}

function toId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw httpError(404, 'item 不存在');
  return id;
}

module.exports = { createApiRouter };
