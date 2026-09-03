const path = require('path');
const express = require('express');
const { initDb } = require('./lib/db');
const { createApiRouter } = require('./lib/routes');
const { UPLOADS_DIR, ensureUploadsDir } = require('./lib/uploads');

const app = express();
const db = initDb();
ensureUploadsDir();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/api', createApiRouter(db));

const publicDir = path.join(__dirname, 'public');
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
// 项目深度详情页（/p/:slug）：前端按 slug 拉取 /api/project/:slug 并渲染 projectDocs
app.get('/p/:slug', (req, res) => res.sendFile(path.join(publicDir, 'detail.html')));
app.use(express.static(publicDir));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// 统一错误处理：不向客户端泄漏堆栈
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  const message = status < 500 && err.expose ? err.message : status < 500 ? '请求无效' : '服务器内部错误';
  res.status(status).json({ error: message });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`personal-site listening on http://0.0.0.0:${PORT}`));
