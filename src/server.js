import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getAuthUrl, handleAuthCallback, isGoogleAuthenticated, getGoogleUserInfo, logoutGoogle } from './auth.js';
import { getPendingFeedPosts, getPendingStories } from './drive.js';
import { logger } from './logger.js';
import { getSchedulerStatus, SCHEDULE_SLOTS } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, '..', 'temp');
const HISTORY_PATH = path.resolve(__dirname, '..', 'data', 'history.json');

function getExpectedSessionToken() {
  const user = (process.env.DASHBOARD_USER || 'admin').trim();
  const pass = (process.env.DASHBOARD_PASS || 'admin2s1m2026').trim();
  return crypto.createHash('sha256').update(`${user}:${pass}:2s1m_secret_salt`).digest('hex');
}

function parseCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function createServer(options = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  app.use('/media', express.static(TEMP_DIR));

  // -----------------------------------------------------------
  // RUTAS PÚBLICAS
  // -----------------------------------------------------------
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Drive-Meta-Publisher',
      plan: '3 Posts + 4 Stories',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  app.get('/login', (req, res) => {
    const errorMsg = req.query.error ? 'Usuario o contraseña incorrectos.' : '';
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>2S1M Auto-Publisher - Acceso</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: 'Inter', sans-serif;
            background: #07090e;
            color: #f8fafc;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .login-card {
            background: #0f1422;
            border: 1px solid #232e4a;
            border-radius: 16px;
            padding: 35px 30px;
            width: 100%;
            max-width: 380px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.5);
            text-align: center;
          }
          .brand-logo {
            width: 52px;
            height: 52px;
            background: linear-gradient(135deg, #f97316, #ea580c);
            border-radius: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            margin-bottom: 15px;
            box-shadow: 0 4px 15px rgba(249, 115, 22, 0.35);
          }
          h1 {
            font-family: 'Outfit', sans-serif;
            font-size: 1.4rem;
            margin: 0 0 5px 0;
            color: #fff;
          }
          p {
            font-size: 0.85rem;
            color: #94a3b8;
            margin: 0 0 25px 0;
          }
          .form-group {
            text-align: left;
            margin-bottom: 16px;
          }
          label {
            display: block;
            font-size: 0.78rem;
            font-weight: 600;
            color: #cbd5e1;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          input {
            width: 100%;
            padding: 12px 14px;
            background: #171f33;
            border: 1px solid #232e4a;
            border-radius: 8px;
            color: #fff;
            font-size: 0.95rem;
            outline: none;
            transition: border-color 0.2s;
          }
          input:focus {
            border-color: #f97316;
          }
          .btn-submit {
            width: 100%;
            padding: 13px;
            background: linear-gradient(135deg, #f97316, #ea580c);
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 700;
            cursor: pointer;
            margin-top: 10px;
            transition: transform 0.2s;
          }
          .btn-submit:hover {
            transform: translateY(-1px);
          }
          .error-pill {
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #f87171;
            font-size: 0.8rem;
            padding: 8px 12px;
            border-radius: 6px;
            margin-bottom: 16px;
          }
        </style>
      </head>
      <body>
        <div class="login-card">
          <div class="brand-logo">🚗</div>
          <h1>2S1M Publisher</h1>
          <p>Panel de Administración Coolify</p>

          ${errorMsg ? `<div class="error-pill">${errorMsg}</div>` : ''}

          <form action="/login" method="POST">
            <div class="form-group">
              <label for="username">Usuario</label>
              <input type="text" id="username" name="username" required autocomplete="username" autofocus>
            </div>
            <div class="form-group">
              <label for="password">Contraseña</label>
              <input type="password" id="password" name="password" required autocomplete="current-password">
            </div>
            <button type="submit" class="btn-submit">Entrar al Panel</button>
          </form>
        </div>
      </body>
      </html>
    `);
  });

  app.post('/login', (req, res) => {
    const username = (req.body?.username || '').trim();
    const password = (req.body?.password || '').trim();
    const expectedUser = (process.env.DASHBOARD_USER || 'admin').trim();
    const expectedPass = (process.env.DASHBOARD_PASS || 'admin2s1m2026').trim();

    if (username === expectedUser && password === expectedPass) {
      const token = getExpectedSessionToken();
      res.setHeader('Set-Cookie', `dash_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
      return res.redirect('/');
    }

    res.redirect('/login?error=1');
  });

  app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'dash_session=; HttpOnly; Path=/; Max-Age=0');
    res.redirect('/login');
  });

  // -----------------------------------------------------------
  // MIDDLEWARE DE PROTECCIÓN
  // -----------------------------------------------------------
  app.use((req, res, next) => {
    if (req.path === '/auth/callback') return next();

    const expectedToken = getExpectedSessionToken();
    const currentToken = parseCookie(req, 'dash_session');

    if (currentToken === expectedToken) {
      return next();
    }

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión en el dashboard.' });
    }

    res.redirect('/login');
  });

  // -----------------------------------------------------------
  // RUTAS GOOGLE OAUTH2
  // -----------------------------------------------------------
  app.get('/auth/google', (req, res) => {
    try {
      const url = getAuthUrl();
      res.redirect(url);
    } catch (err) {
      res.status(500).send(`<h3>Error de configuración OAuth:</h3><p>${err.message}</p><p><a href="/">Volver</a></p>`);
    }
  });

  app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('No se recibió el código de autorización.');
    }
    try {
      await handleAuthCallback(code);
      res.redirect('/?auth=success');
    } catch (err) {
      console.error('[OAuth Callback Error]', err);
      res.status(500).send(`<h3>Error al autenticar:</h3><p>${err.message}</p><p><a href="/">Volver</a></p>`);
    }
  });

  app.get('/auth/google-logout', (req, res) => {
    logoutGoogle();
    res.redirect('/?logout=success');
  });

  // -----------------------------------------------------------
  // API DE ESTADO, LOGS Y ACCIONES MANUALES
  // -----------------------------------------------------------
  app.get('/api/logs', (req, res) => {
    res.json({ logs: logger.getLogs(200) });
  });

  app.post('/api/logs/clear', (req, res) => {
    logger.clearLogs();
    res.json({ success: true });
  });

  app.get('/api/scheduler-status', (req, res) => {
    res.json(getSchedulerStatus());
  });

  app.get('/api/status', async (req, res) => {
    const authenticated = isGoogleAuthenticated();
    let userInfo = null;
    let pendingFeed = [];
    let pendingStories = [];
    let driveError = null;

    if (authenticated) {
      userInfo = await getGoogleUserInfo();
      try {
        pendingFeed = await getPendingFeedPosts();
        pendingStories = await getPendingStories();
      } catch (err) {
        driveError = err.message;
      }
    }

    let history = [];
    if (fs.existsSync(HISTORY_PATH)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      } catch (e) {}
    }

    res.json({
      authenticated,
      user: userInfo,
      pendingFeedCount: pendingFeed.length,
      pendingFeed,
      pendingStoriesCount: pendingStories.length,
      pendingStories,
      driveError,
      history,
      scheduler: getSchedulerStatus(),
      uptime: Math.round(process.uptime())
    });
  });

  app.post('/api/publish-feed', async (req, res) => {
    if (typeof options.onPublishFeed === 'function') {
      try {
        const result = await options.onPublishFeed();
        res.json({ success: true, result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    } else {
      res.status(501).json({ error: 'Handler onPublishFeed no configurado' });
    }
  });

  app.post('/api/publish-story', async (req, res) => {
    if (typeof options.onPublishStory === 'function') {
      try {
        const result = await options.onPublishStory();
        res.json({ success: true, result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    } else {
      res.status(501).json({ error: 'Handler onPublishStory no configurado' });
    }
  });

  app.post('/api/publish-now', async (req, res) => {
    if (typeof options.onManualPublish === 'function') {
      try {
        const result = await options.onManualPublish();
        res.json({ success: true, result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    } else {
      res.status(501).json({ error: 'Handler no configurado' });
    }
  });

  // -----------------------------------------------------------
  // DASHBOARD PRINCIPAL
  // -----------------------------------------------------------
  app.get('/', async (req, res) => {
    const authenticated = isGoogleAuthenticated();
    let userInfo = null;
    let pendingFeed = [];
    let pendingStories = [];
    let driveError = null;

    if (authenticated) {
      userInfo = await getGoogleUserInfo();
      try {
        pendingFeed = await getPendingFeedPosts();
        pendingStories = await getPendingStories();
      } catch (e) {
        driveError = e.message;
      }
    }

    let history = [];
    if (fs.existsSync(HISTORY_PATH)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      } catch (e) {}
    }

    const schedulerState = getSchedulerStatus();

    // Render Posts Feed
    const pendingFeedHtml = pendingFeed.length > 0
      ? pendingFeed.map((p, i) => `
          <div class="post-item">
            <div class="post-info">
              <div class="post-title">${i + 1}. ${p.postSlug}</div>
              <div class="post-tags">
                <span class="tag tag-img">📷 1:1 Cuadrado</span>
                <span class="tag ${p.docFile ? 'tag-doc' : 'tag-warn'}">
                  ${p.docFile ? `📄 ${p.docFile.name}` : '⚠️ Sin Doc emparejado'}
                </span>
                <span class="tag tag-feed">📱 FB Feed + IG Feed</span>
              </div>
            </div>
            <div class="post-badge">En Cola</div>
          </div>
        `).join('')
      : `<div class="empty-state">No hay más posts de Feed ("Post *") pendientes en Google Drive.</div>`;

    // Render Stories
    const pendingStoriesHtml = pendingStories.length > 0
      ? pendingStories.map((s, i) => `
          <div class="post-item">
            <div class="post-info">
              <div class="post-title">${i + 1}. ${s.storySlug}</div>
              <div class="post-tags">
                <span class="tag tag-story">⚡ 9:16 Vertical</span>
                <span class="tag tag-multi">📱 FB Story + IG Story</span>
              </div>
            </div>
            <div class="post-badge badge-story">Story Lista</div>
          </div>
        `).join('')
      : `<div class="empty-state">No hay stories pendientes ("Stories 2s1m *") en Google Drive.</div>`;

    // Render Historial
    const historyHtml = history.length > 0
      ? history.slice(0, 10).map(h => {
          const isStory = h.type === 'story' || h.postSlug?.toLowerCase().startsWith('stories');
          return `
            <div class="history-item">
              <div class="history-info">
                <div class="history-title">
                  ${isStory ? '⚡ [STORY]' : '🖼️ [FEED]'} ${h.postSlug}
                </div>
                <div class="history-date">${new Date(h.timestamp).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
              <div class="history-links">
                ${h.facebookUrl ? `<a href="${h.facebookUrl}" target="_blank" class="link-btn fb-btn">📘 Facebook</a>` : ''}
                ${h.instagramUrl ? `<a href="${h.instagramUrl}" target="_blank" class="link-btn ig-btn">📸 Instagram</a>` : ''}
                ${isStory ? `<span class="story-pill">⚡ Pantalla Completa</span>` : ''}
              </div>
            </div>
          `;
        }).join('')
      : `<div class="empty-state">Aún no hay publicaciones registradas en el historial.</div>`;

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>2S1M Auto-Publisher (3 Posts + 4 Stories)</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@500;600;700;800&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg-body: #07090e;
            --bg-card: #0f1422;
            --bg-surface: #171f33;
            --border-color: #232e4a;
            --primary: #f97316;
            --primary-hover: #ea580c;
            --accent-blue: #3b82f6;
            --accent-green: #10b981;
            --accent-purple: #a855f7;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
          }
          * { box-sizing: border-box; }
          body {
            font-family: 'Inter', sans-serif;
            background: var(--bg-body);
            color: var(--text-main);
            margin: 0;
            padding: 25px 20px 60px 20px;
            -webkit-font-smoothing: antialiased;
          }
          .container { max-width: 900px; margin: 0 auto; }
          
          /* Header */
          .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-color);
          }
          .brand { display: flex; align-items: center; gap: 12px; }
          .brand-logo {
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, #f97316, #de6f00);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            box-shadow: 0 4px 15px rgba(249, 115, 22, 0.3);
          }
          .brand-title {
            font-family: 'Outfit', sans-serif;
            font-size: 1.45rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            color: #fff;
          }
          .brand-subtitle { font-size: 0.82rem; color: var(--text-muted); }

          .header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            border-radius: 99px;
            font-size: 0.8rem;
            font-weight: 600;
          }
          .status-connected { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
          .status-disconnected { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
          .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

          .btn-dash-logout {
            color: var(--text-muted);
            font-size: 0.8rem;
            text-decoration: none;
            padding: 6px 12px;
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.2s;
          }
          .btn-dash-logout:hover { color: #f87171; border-color: rgba(239, 68, 68, 0.4); }

          /* Cards */
          .card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            padding: 22px;
            margin-bottom: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          }
          .card-title {
            font-family: 'Outfit', sans-serif;
            font-size: 1.1rem;
            font-weight: 600;
            color: #fff;
            margin-top: 0;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          /* Monitor Card (Reloj & Próxima Franja) */
          .monitor-banner {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 16px;
          }
          .monitor-box {
            background: #131a2e;
            border: 1px solid #233052;
            border-radius: 12px;
            padding: 16px;
          }
          .monitor-label {
            font-size: 0.72rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 700;
            margin-bottom: 6px;
          }
          .monitor-value {
            font-family: 'Outfit', sans-serif;
            font-size: 1.55rem;
            font-weight: 800;
            color: #fff;
            letter-spacing: -0.02em;
          }
          .monitor-sub {
            font-size: 0.8rem;
            color: #38bdf8;
            margin-top: 4px;
            font-weight: 500;
          }

          .next-highlight {
            background: linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(234, 88, 12, 0.05));
            border-color: rgba(249, 115, 22, 0.35);
          }
          .next-highlight .monitor-value { color: #fb923c; }

          /* Slots Grid (7 slots) */
          .slots-row-7 {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 8px;
            margin-top: 10px;
          }
          .slot-card {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px 6px;
            text-align: center;
            transition: all 0.2s;
          }
          .slot-time { font-size: 1rem; font-weight: 800; color: #fff; font-family: 'Outfit', sans-serif; }
          .slot-type-badge {
            display: inline-block;
            font-size: 0.65rem;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 4px;
            margin-top: 4px;
            text-transform: uppercase;
          }
          .type-feed { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
          .type-story { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
          
          .slot-badge-state {
            display: block;
            font-size: 0.62rem;
            padding: 2px 4px;
            border-radius: 4px;
            font-weight: 700;
            margin-top: 5px;
          }
          .state-done { background: rgba(16, 185, 129, 0.2); color: #34d399; }
          .state-next { background: rgba(249, 115, 22, 0.25); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.4); }
          .state-wait { color: #64748b; }

          /* Action Buttons Bar */
          .action-buttons-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 15px;
          }
          .btn-action {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 13px;
            border-radius: 10px;
            font-weight: 700;
            font-size: 0.92rem;
            border: none;
            cursor: pointer;
            transition: all 0.2s;
          }
          .btn-feed {
            background: linear-gradient(135deg, #f97316, #ea580c);
            color: #fff;
            box-shadow: 0 4px 15px rgba(249, 115, 22, 0.25);
          }
          .btn-feed:hover { background: linear-gradient(135deg, #fb923c, #f97316); }
          .btn-story {
            background: linear-gradient(135deg, #9333ea, #7e22ce);
            color: #fff;
            box-shadow: 0 4px 15px rgba(147, 51, 234, 0.25);
          }
          .btn-story:hover { background: linear-gradient(135deg, #a855f7, #9333ea); }
          .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }

          /* Terminal / Logs */
          .terminal-card {
            background: #090c15;
            border: 1px solid #1c263c;
            border-radius: 12px;
            overflow: hidden;
            margin-top: 10px;
          }
          .terminal-bar {
            background: #111728;
            padding: 10px 14px;
            border-bottom: 1px solid #1c263c;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .terminal-title {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
            color: #94a3b8;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .terminal-controls {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .btn-term {
            background: #1c253b;
            border: 1px solid #2d3b5d;
            color: #cbd5e1;
            font-size: 0.72rem;
            padding: 4px 10px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
          }
          .btn-term:hover { background: #283654; color: #fff; }
          .terminal-body {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.75rem;
            padding: 14px;
            height: 230px;
            overflow-y: auto;
            color: #e2e8f0;
            background: #060810;
            line-height: 1.55;
          }
          .log-line {
            display: flex;
            gap: 10px;
            padding: 2px 0;
            border-bottom: 1px solid rgba(255,255,255,0.02);
            word-break: break-word;
          }
          .log-time { color: #64748b; white-space: nowrap; flex-shrink: 0; }
          .log-tag {
            font-weight: 700;
            border-radius: 3px;
            padding: 0 4px;
            font-size: 0.68rem;
            flex-shrink: 0;
            height: fit-content;
          }
          .tag-info { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
          .tag-success { background: rgba(16, 185, 129, 0.25); color: #34d399; }
          .tag-warn { background: rgba(245, 158, 11, 0.25); color: #fbbf24; }
          .tag-error { background: rgba(239, 68, 68, 0.25); color: #f87171; }
          .tag-cron { background: rgba(168, 85, 247, 0.25); color: #c084fc; }
          .log-msg { color: #cbd5e1; flex: 1; }

          /* User Bar */
          .user-bar {
            display: flex;
            align-items: center;
            gap: 12px;
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            padding: 10px 14px;
            border-radius: 10px;
            margin-bottom: 18px;
          }
          .user-avatar { width: 34px; height: 34px; border-radius: 50%; }
          .user-details { flex: 1; }
          .user-name { font-size: 0.9rem; font-weight: 600; }
          .user-email { font-size: 0.75rem; color: var(--text-muted); }
          .btn-google-logout {
            color: #f87171;
            font-size: 0.75rem;
            text-decoration: none;
            padding: 5px 10px;
            background: rgba(239, 68, 68, 0.1);
            border-radius: 6px;
            border: 1px solid rgba(239, 68, 68, 0.25);
            font-weight: 600;
          }

          /* Posts list */
          .post-item {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 13px 15px;
            margin-bottom: 9px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .post-title { font-weight: 600; font-size: 0.92rem; color: #fff; }
          .post-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
          .tag { font-size: 0.72rem; padding: 2px 7px; border-radius: 4px; font-weight: 500; }
          .tag-img { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
          .tag-doc { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
          .tag-feed { background: rgba(249, 115, 22, 0.15); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.3); }
          .tag-story { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
          .tag-warn { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
          .post-badge {
            background: rgba(251, 146, 60, 0.12);
            color: #fb923c;
            border: 1px solid rgba(251, 146, 60, 0.3);
            padding: 4px 10px;
            border-radius: 99px;
            font-size: 0.72rem;
            font-weight: 700;
          }
          .badge-story {
            background: rgba(168, 85, 247, 0.12);
            color: #c084fc;
            border-color: rgba(168, 85, 247, 0.3);
          }

          /* History */
          .history-item {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 12px 15px;
            margin-bottom: 9px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .history-title { font-weight: 600; font-size: 0.88rem; }
          .history-date { font-size: 0.74rem; color: var(--text-muted); margin-top: 3px; }
          .history-links { display: flex; align-items: center; gap: 8px; }
          .link-btn {
            font-size: 0.73rem;
            padding: 4px 9px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 4px;
          }
          .fb-btn { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
          .ig-btn { background: rgba(236, 72, 153, 0.15); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3); }
          .story-pill {
            background: rgba(168, 85, 247, 0.15);
            color: #c084fc;
            border: 1px solid rgba(168, 85, 247, 0.3);
            font-size: 0.7rem;
            padding: 3px 8px;
            border-radius: 99px;
            font-weight: 700;
          }
          .empty-state { text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 22px 0; }

          @media (max-width: 700px) {
            .slots-row-7 { grid-template-columns: repeat(3, 1fr); }
            .action-buttons-grid { grid-template-columns: 1fr; }
            .monitor-banner { grid-template-columns: 1fr; }
            .post-item, .history-item { flex-direction: column; align-items: flex-start; gap: 8px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Header -->
          <header class="app-header">
            <div class="brand">
              <div class="brand-logo">🚗</div>
              <div>
                <div class="brand-title">2S1M Auto-Publisher</div>
                <div class="brand-subtitle">Google Drive ➔ Meta Social Media Hub (3 Posts + 4 Stories)</div>
              </div>
            </div>
            <div class="header-actions">
              <div class="status-badge ${authenticated ? 'status-connected' : 'status-disconnected'}">
                <span class="dot"></span>
                ${authenticated ? 'Google Conectado' : 'Sin Conexión'}
              </div>
              <a href="/logout" class="btn-dash-logout" title="Cerrar sesión del panel">🔒 Salir</a>
            </div>
          </header>

          <!-- User Card -->
          ${authenticated && userInfo ? `
            <div class="user-bar">
              ${userInfo.picture ? `<img src="${userInfo.picture}" alt="Avatar" class="user-avatar">` : ''}
              <div class="user-details">
                <div class="user-name">${userInfo.name || 'Usuario Google'}</div>
                <div class="user-email">${userInfo.email}</div>
              </div>
              <a href="/auth/google-logout" class="btn-google-logout">Desconectar Drive</a>
            </div>
          ` : `
            <div class="card" style="text-align: center; background: rgba(37, 99, 235, 0.08); border-color: rgba(37, 99, 235, 0.3);">
              <h2 style="font-family:'Outfit'; font-size:1.2rem; margin-top:0;">🔐 Conecta tu Google Drive</h2>
              <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">
                Permite al bot acceder a "My Drive" para leer automáticamente los posts y stories creados por Spark.
              </p>
              <a href="/auth/google" style="display:inline-block; padding:12px 24px; background:#2563eb; color:#fff; border-radius:8px; text-decoration:none; font-weight:700;">Iniciar Sesión con Google</a>
            </div>
          `}

          <!-- Monitor de Programación & Horario Oficial -->
          <div class="card">
            <div class="card-title">
              <span>⏰ Programación Diaria Oficial (Casablanca)</span>
              <span style="font-size:0.8rem; font-weight:500; color:var(--text-muted);">GMT+1</span>
            </div>

            <div class="monitor-banner">
              <div class="monitor-box">
                <div class="monitor-label">🕒 Reloj en Casablanca (Marruecos)</div>
                <div class="monitor-value" id="casablanca-clock">${schedulerState.currentTimeOnly}</div>
                <div class="monitor-sub">Fecha: <span id="casablanca-date">${schedulerState.currentDateOnly}</span></div>
              </div>

              <div class="monitor-box next-highlight">
                <div class="monitor-label">🎯 Próxima Ejecución Programada</div>
                <div class="monitor-value" id="next-slot-val">${schedulerState.nextSlot.time}</div>
                <div class="monitor-sub" id="next-slot-label">${schedulerState.nextSlot.badgeText} - ${schedulerState.nextSlot.label}</div>
              </div>
            </div>

            <div>
              <div class="monitor-label" style="margin-bottom:6px;">Las 7 Franjas Diarias (3 Posts Feed + 4 Stories):</div>
              <div class="slots-row-7">
                ${SCHEDULE_SLOTS.map(slot => {
                  const slotKey = `${schedulerState.currentDateOnly}_${slot.time}`;
                  const isDone = schedulerState.executedToday.includes(slotKey);
                  const isNext = schedulerState.nextSlot.time === slot.time && !schedulerState.nextSlot.isTomorrow;
                  let badge = '<span class="slot-badge-state state-wait">En espera</span>';
                  if (isDone) badge = '<span class="slot-badge-state state-done">✅ Hecho</span>';
                  else if (isNext) badge = '<span class="slot-badge-state state-next">⚡ Siguiente</span>';

                  const typeClass = slot.type === 'feed' ? 'type-feed' : 'type-story';
                  const typeLabel = slot.type === 'feed' ? `Post ${slot.index}` : `Story ${slot.index}`;

                  return `
                    <div class="slot-card" style="${isNext ? 'border-color: rgba(249,115,22,0.4); background: rgba(249,115,22,0.05);' : ''}">
                      <div class="slot-time">${slot.time}</div>
                      <div><span class="slot-type-badge ${typeClass}">${typeLabel}</span></div>
                      <div>${badge}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            ${authenticated ? `
              <div class="action-buttons-grid">
                <button class="btn-action btn-feed" onclick="publishFeedNow()" id="btn-pub-feed">
                  🚀 Publicar Siguiente Post de Feed (1:1)
                </button>
                <button class="btn-action btn-story" onclick="publishStoryNow()" id="btn-pub-story">
                  ⚡ Publicar Siguiente Story 2S1M (9:16)
                </button>
              </div>
              <div id="pub-status" style="margin-top: 10px; font-size: 0.85rem; text-align: center;"></div>
            ` : ''}
          </div>

          <!-- Consola de Logs en Vivo -->
          <div class="card">
            <div class="card-title">
              <span>💻 Consola de Registros en Vivo (Live Logs)</span>
              <div class="terminal-controls">
                <label style="font-size:0.75rem; color:var(--text-muted); display:inline-flex; align-items:center; gap:4px; cursor:pointer;">
                  <input type="checkbox" id="auto-refresh-logs" checked> Auto-recarga
                </label>
                <button class="btn-term" onclick="fetchLogs()">🔄 Refrescar</button>
                <button class="btn-term" onclick="clearLogs()">🧹 Limpiar</button>
              </div>
            </div>

            <div class="terminal-card">
              <div class="terminal-bar">
                <div class="terminal-title">
                  <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;"></span>
                  drive-meta-publisher / activity.log
                </div>
                <div style="font-size:0.7rem; color:#64748b;" id="log-count">0 entradas</div>
              </div>
              <div class="terminal-body" id="terminal-body">
                <div style="color:#64748b;">Cargando registros del sistema...</div>
              </div>
            </div>
          </div>

          <!-- Cola de Feed -->
          ${authenticated ? `
            <div class="card">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div class="card-title" style="margin:0;">
                  📦 Posts de Feed Pendientes en Drive (${pendingFeed.length})
                </div>
                <button onclick="location.reload()" style="background:var(--bg-surface); border:1px solid var(--border-color); color:var(--text-muted); padding:5px 10px; border-radius:6px; cursor:pointer; font-size:0.8rem;">
                  🔄 Actualizar
                </button>
              </div>
              ${pendingFeedHtml}
            </div>
          ` : ''}

          <!-- Cola de Stories -->
          ${authenticated ? `
            <div class="card">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div class="card-title" style="margin:0;">
                  ⚡ Stories 2S1M Pendientes en Drive (${pendingStories.length})
                </div>
                <button onclick="location.reload()" style="background:var(--bg-surface); border:1px solid var(--border-color); color:var(--text-muted); padding:5px 10px; border-radius:6px; cursor:pointer; font-size:0.8rem;">
                  🔄 Actualizar
                </button>
              </div>
              ${pendingStoriesHtml}
            </div>
          ` : ''}

          <!-- History -->
          <div class="card">
            <div class="card-title">📜 Historial de Publicaciones Realizadas</div>
            ${historyHtml}
          </div>
        </div>

        <script>
          async function publishFeedNow() {
            const btn = document.getElementById('btn-pub-feed');
            const status = document.getElementById('pub-status');
            btn.disabled = true;
            btn.textContent = '⏳ Publicando Post en Feed...';
            status.innerHTML = '<span style="color:#fb923c;">Descargando post de Drive y enviando a Facebook e Instagram...</span>';

            try {
              const res = await fetch('/api/publish-feed', { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                status.innerHTML = '<span style="color:#34d399; font-weight:600;">✅ ¡Post de Feed publicado con éxito!</span>';
                fetchLogs();
                setTimeout(() => location.reload(), 2000);
              } else {
                status.innerHTML = '<span style="color:#f87171;">❌ Error: ' + (data.error || 'Fallo desconocido') + '</span>';
                btn.disabled = false;
                btn.textContent = '🚀 Publicar Siguiente Post de Feed (1:1)';
                fetchLogs();
              }
            } catch (e) {
              status.innerHTML = '<span style="color:#f87171;">❌ Error de conexión</span>';
              btn.disabled = false;
              btn.textContent = '🚀 Publicar Siguiente Post de Feed (1:1)';
            }
          }

          async function publishStoryNow() {
            const btn = document.getElementById('btn-pub-story');
            const status = document.getElementById('pub-status');
            btn.disabled = true;
            btn.textContent = '⏳ Publicando Story...';
            status.innerHTML = '<span style="color:#c084fc;">Descargando Story vertical y enviando a FB e IG Stories...</span>';

            try {
              const res = await fetch('/api/publish-story', { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                status.innerHTML = '<span style="color:#34d399; font-weight:600;">✅ ¡Story 2S1M publicada a pantalla completa con éxito!</span>';
                fetchLogs();
                setTimeout(() => location.reload(), 2000);
              } else {
                status.innerHTML = '<span style="color:#f87171;">❌ Error: ' + (data.error || 'Fallo desconocido') + '</span>';
                btn.disabled = false;
                btn.textContent = '⚡ Publicar Siguiente Story 2S1M (9:16)';
                fetchLogs();
              }
            } catch (e) {
              status.innerHTML = '<span style="color:#f87171;">❌ Error de conexión</span>';
              btn.disabled = false;
              btn.textContent = '⚡ Publicar Siguiente Story 2S1M (9:16)';
            }
          }

          let lastLogCount = 0;
          async function fetchLogs() {
            try {
              const res = await fetch('/api/logs');
              const data = await res.json();
              const term = document.getElementById('terminal-body');
              const countEl = document.getElementById('log-count');

              if (!data.logs || data.logs.length === 0) {
                term.innerHTML = '<div style="color:#64748b;">(No hay registros recientes aún)</div>';
                countEl.textContent = '0 entradas';
                return;
              }

              countEl.textContent = data.logs.length + ' entradas';

              term.innerHTML = data.logs.map(l => {
                const tagClass = 'tag-' + (l.level || 'info');
                return \`
                  <div class="log-line">
                    <span class="log-time">\${l.timeStr || ''}</span>
                    <span class="log-tag \${tagClass}">[\${(l.level || 'INFO').toUpperCase()}]</span>
                    <span class="log-msg">\${escapeHtml(l.message)}</span>
                  </div>
                \`;
              }).join('');

              if (data.logs.length !== lastLogCount) {
                lastLogCount = data.logs.length;
                term.scrollTop = term.scrollHeight;
              }
            } catch (e) {
              console.error('Error fetching logs', e);
            }
          }

          async function clearLogs() {
            await fetch('/api/logs/clear', { method: 'POST' });
            fetchLogs();
          }

          async function updateSchedulerStatus() {
            try {
              const res = await fetch('/api/scheduler-status');
              const data = await res.json();
              if (data.currentTimeOnly) {
                document.getElementById('casablanca-clock').textContent = data.currentTimeOnly;
                document.getElementById('casablanca-date').textContent = data.currentDateOnly;
              }
              if (data.nextSlot) {
                document.getElementById('next-slot-val').textContent = data.nextSlot.time;
                document.getElementById('next-slot-label').textContent = data.nextSlot.badgeText + ' - ' + data.nextSlot.label;
              }
            } catch (e) {}
          }

          function escapeHtml(str) {
            return String(str)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          }

          fetchLogs();
          setInterval(() => {
            if (document.getElementById('auto-refresh-logs').checked) {
              fetchLogs();
            }
            updateSchedulerStatus();
          }, 4000);
        </script>
      </body>
      </html>
    `);
  });

  return app;
}
