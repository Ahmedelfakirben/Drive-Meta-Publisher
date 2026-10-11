import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const LOG_FILE = path.resolve(DATA_DIR, 'app.log');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MAX_MEMORY_LOGS = 300;
const memoryLogs = [];

// Cargar logs previos si existen
if (fs.existsSync(LOG_FILE)) {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    for (const line of lines.slice(-MAX_MEMORY_LOGS)) {
      try {
        memoryLogs.push(JSON.parse(line));
      } catch (e) {
        memoryLogs.push({
          timestamp: new Date().toISOString(),
          timeStr: '',
          level: 'info',
          message: line
        });
      }
    }
  } catch (e) {}
}

function appendLog(level, message) {
  const now = new Date();
  const timeStr = now.toLocaleString('es-ES', { timeZone: process.env.TIMEZONE || 'Africa/Casablanca' });
  const entry = {
    timestamp: now.toISOString(),
    timeStr,
    level,
    message: typeof message === 'object' ? JSON.stringify(message) : String(message)
  };

  memoryLogs.push(entry);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.shift();
  }

  // Guardar en archivo app.log
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {}

  // Consola estándar con formato
  const prefix = `[${timeStr}] [${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(`${prefix} ${entry.message}`);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${entry.message}`);
  } else {
    console.log(`${prefix} ${entry.message}`);
  }

  return entry;
}

export const logger = {
  info: (msg) => appendLog('info', msg),
  success: (msg) => appendLog('success', msg),
  warn: (msg) => appendLog('warn', msg),
  error: (msg) => appendLog('error', msg),
  cron: (msg) => appendLog('cron', msg),
  getLogs: (limit = 100) => memoryLogs.slice(-limit),
  clearLogs: () => {
    memoryLogs.length = 0;
    try {
      fs.writeFileSync(LOG_FILE, '');
    } catch (e) {}
  }
};
