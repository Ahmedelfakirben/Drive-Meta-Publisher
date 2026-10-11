import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SLOTS_FILE = path.resolve(DATA_DIR, 'executed_slots.json');

const TIMEZONE = process.env.TIMEZONE || 'Africa/Casablanca';
const DEFAULT_SLOTS = [10, 14, 18, 21];

let lastExecutionInfo = null;
let isPublishing = false;
let checkInterval = null;
let lastHeartbeatHour = -1;

function getExecutedSlots() {
  if (fs.existsSync(SLOTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf-8'));
    } catch (e) {}
  }
  return {};
}

function saveExecutedSlot(slotKey) {
  const data = getExecutedSlots();
  data[slotKey] = {
    executedAt: new Date().toISOString(),
    success: true
  };
  try {
    fs.writeFileSync(SLOTS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

/**
 * Obtiene la fecha y hora actual en la zona horaria de Casablanca
 */
export function getCasablancaDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10);
  const day = parseInt(map.day, 10);
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const second = parseInt(map.second, 10);

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

  return { year, month, day, hour, minute, second, dateStr, timeStr };
}

/**
 * Extrae las horas configuradas del cron (ej: '0 10,14,18,21 * * *' -> [10, 14, 18, 21])
 */
export function getConfiguredSlots() {
  const cronExpr = process.env.CRON_SCHEDULE || '0 10,14,18,21 * * *';
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length >= 2 && parts[1] !== '*') {
    const hours = parts[1].split(',').map(h => parseInt(h, 10)).filter(h => !isNaN(h) && h >= 0 && h <= 23);
    if (hours.length > 0) return hours.sort((a, b) => a - b);
  }
  return DEFAULT_SLOTS;
}

/**
 * Calcula la próxima franja horaria programada y los segundos restantes
 */
export function getNextSlotInfo() {
  const { hour, minute, second, dateStr } = getCasablancaDate();
  const slots = getConfiguredSlots();

  // Buscar el siguiente slot hoy
  let nextSlot = slots.find(s => s > hour || (s === hour && minute === 0 && second === 0));
  let isTomorrow = false;

  if (nextSlot === undefined) {
    // Si ya pasaron todas las horas de hoy, la próxima es la primera de mañana
    nextSlot = slots[0];
    isTomorrow = true;
  }

  // Calcular minutos restantes
  let diffMinutes = 0;
  if (!isTomorrow) {
    diffMinutes = (nextSlot * 60) - (hour * 60 + minute);
  } else {
    diffMinutes = (24 * 60 - (hour * 60 + minute)) + (nextSlot * 60);
  }

  return {
    nextSlotHour: nextSlot,
    nextSlotFormatted: `${String(nextSlot).padStart(2, '0')}:00`,
    isTomorrow,
    diffMinutes: Math.max(0, diffMinutes),
    label: isTomorrow ? `Mañana a las ${nextSlot}:00` : `Hoy a las ${nextSlot}:00 (en ${diffMinutes} min)`
  };
}

/**
 * Obtiene el estado consolidado del programador para el Dashboard
 */
export function getSchedulerStatus() {
  const casablanca = getCasablancaDate();
  const next = getNextSlotInfo();
  const slots = getConfiguredSlots();
  const executed = getExecutedSlots();

  return {
    timezone: TIMEZONE,
    casablancaTime: `${casablanca.dateStr} ${casablanca.timeStr}`,
    currentTimeOnly: casablanca.timeStr,
    currentDateOnly: casablanca.dateStr,
    configuredSlots: slots,
    nextSlot: next,
    isPublishing,
    lastExecution: lastExecutionInfo,
    executedToday: Object.keys(executed).filter(k => k.startsWith(casablanca.dateStr))
  };
}

/**
 * Inicia el programador resiliente
 */
export function startScheduler(publishCallback) {
  const slots = getConfiguredSlots();
  logger.info(`⏰ Programador resiliente iniciado. Horarios en ${TIMEZONE}: ${slots.map(s => s + ':00').join(', ')}`);

  const next = getNextSlotInfo();
  logger.info(`🎯 Próxima publicación prevista: ${next.label}`);

  // Chequeo cada 15 segundos
  checkInterval = setInterval(async () => {
    if (isPublishing) return;

    const cb = getCasablancaDate();
    const slotKey = `${cb.dateStr}_${cb.hour}`;
    const executed = getExecutedSlots();

    // Heartbeat informativo una vez por hora
    if (cb.minute === 0 && cb.hour !== lastHeartbeatHour) {
      lastHeartbeatHour = cb.hour;
      const nextInfo = getNextSlotInfo();
      logger.info(`💓 [Heartbeat] Hora Casablanca: ${cb.timeStr}. Próxima franja: ${nextInfo.label}`);
    }

    // Comprobar si la hora actual coincide con un slot programado
    if (slots.includes(cb.hour)) {
      if (!executed[slotKey]) {
        // Ejecutar publicación para este slot
        isPublishing = true;
        logger.cron(`🚀 [Franja ${cb.hour}:00] Iniciando publicación automática programada...`);

        try {
          const result = await publishCallback();
          saveExecutedSlot(slotKey);
          lastExecutionInfo = {
            slot: `${cb.hour}:00`,
            timestamp: new Date().toISOString(),
            status: 'success',
            postSlug: result?.postSlug || 'Post publicado',
            results: result?.results
          };
          logger.success(`✅ [Franja ${cb.hour}:00] Publicación completada con éxito: "${result?.postSlug || ''}"`);
        } catch (err) {
          lastExecutionInfo = {
            slot: `${cb.hour}:00`,
            timestamp: new Date().toISOString(),
            status: 'error',
            error: err.message
          };
          logger.error(`❌ [Franja ${cb.hour}:00] Error al publicar: ${err.message}`);
        } finally {
          isPublishing = false;
        }
      }
    }
  }, 15000);

  return checkInterval;
}

export function stopScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
