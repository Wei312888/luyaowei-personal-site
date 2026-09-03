const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { DATA_DIR } = require('./db');
const { httpError } = require('./errors');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function uploadRouter() {
  const router = express.Router();

  router.post(
    '/upload',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], limit: '5mb' }),
    (req, res) => {
      const ext = EXT_BY_TYPE[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
      if (!ext) throw httpError(400, '仅支持 png/jpg/webp/gif 图片');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw httpError(400, '请求体必须是图片二进制');
      ensureUploadsDir();
      const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS_DIR, name), req.body);
      res.status(201).json({ url: '/uploads/' + name });
    }
  );

  router.delete('/upload', (req, res) => {
    const url = req.body && req.body.url;
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) throw httpError(400, 'url 必须以 /uploads/ 开头');
    const file = path.resolve(UPLOADS_DIR, url.slice('/uploads/'.length));
    if (!file.startsWith(UPLOADS_DIR + path.sep)) throw httpError(400, '非法路径');
    try {
      fs.unlinkSync(file);
    } catch (e) {
      if (e.code === 'ENOENT') throw httpError(404, '文件不存在');
      throw e;
    }
    res.json({ ok: true });
  });

  return router;
}

module.exports = { UPLOADS_DIR, ensureUploadsDir, uploadRouter };
