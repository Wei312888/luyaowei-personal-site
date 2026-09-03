const crypto = require('crypto');
const express = require('express');
const { kvGet, kvSet } = require('./db');

const COOKIE_NAME = 'lyw_session';
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const SEVEN_DAYS_MS = SEVEN_DAYS_SECONDS * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function getSessionSecret(db) {
  let secret = kvGet(db, 'session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    kvSet(db, 'session_secret', secret);
  }
  return secret;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function makeToken(db) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SEVEN_DAYS_MS })).toString('base64url');
  return `${payload}.${sign(payload, getSessionSecret(db))}`;
}

function verifyToken(db, token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, getSessionSecret(db)));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const cookies = {};
  const raw = req.headers.cookie;
  if (!raw) return cookies;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

function setSessionCookie(res, db) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${makeToken(db)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SEVEN_DAYS_SECONDS}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAuth(db) {
  return (req, res, next) => {
    if (!verifyToken(db, parseCookies(req)[COOKIE_NAME])) return res.status(401).json({ error: 'unauthorized' });
    next();
  };
}

function authRouter(db) {
  const router = express.Router();
  router.get('/state', (req, res) => {
    res.json({
      setupNeeded: !kvGet(db, 'password_hash'),
      authenticated: verifyToken(db, parseCookies(req)[COOKIE_NAME])
    });
  });
  router.post('/setup', (req, res) => {
    const password = req.body && req.body.password;
    if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    if (kvGet(db, 'password_hash')) return res.status(400).json({ error: '密码已设置，请直接登录' });
    kvSet(db, 'password_hash', hashPassword(password));
    setSessionCookie(res, db);
    res.json({ ok: true });
  });
  router.post('/login', (req, res) => {
    const password = req.body && req.body.password;
    const stored = kvGet(db, 'password_hash');
    if (!stored || typeof password !== 'string' || !verifyPassword(password, stored)) {
      return res.status(401).json({ error: '密码错误' });
    }
    setSessionCookie(res, db);
    res.json({ ok: true });
  });
  router.post('/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });
  return router;
}

module.exports = { authRouter, requireAuth };
