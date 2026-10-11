import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SLOTS_FILE = path.resolve(DATA_DIR, 'executed_slots.json');

const TIMEZONE = process.env.TIMEZONE || 'Africa/Casablanca';

/**
 * Las 7 Franjas Diarias Oficiales (3 Posts de Feed + 4 Stories Exclusivas)
 */
export const SCHEDULE_SLOTS = [
  { time: '10:00', hour: 10, minute: 0, type: 'story', index: 1, label: 'Story 1 (Aeronáutica / Llegadas)' },
  { time: '11:30', hour: 11, minute: 30, type: 'feed', index: 1, label: 'Post 1 (VIP & Aeropuertos)' },
  { time: '13:30', hour: 13, minute: 30, type: 'story', index: 2, label: 'Story 2 (Tarifas 250 DH/día)' },
  { time: '15:30', hour: 15, minute: 30, type: 'feed', index: 2, label: 'Post 2 (Afiche Comercial)' },
  { time: '18:00', hour: 18, minute: 0, type: 'story', index: 3, label: 'Story 3 (Escapadas / Ruta norte)' },
  { time: '20:00', hour: 20, minute: 0, type: 'feed', index: 3, label: 'Post 3 (Lifestyle / Noche)' },
  { time: '21:30', hour: 21, minute: 30, type: 'story', index: 4, label: 'Story 4 (Contacto WhatsApp / CTA)' }
];

let lastExecutionInfo = null;
let isPublishing = false;
let checkInterval = null;
let lastHeartbeatSlot = '';

function getExecutedSlots() {
  if (fs.existsSync(SLOTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf-8'));
    } catch (e) {}
  }
  return {};
}

function saveExecutedSlot(slotKey, details) {
  const data = getExecutedSlots();
  data[slotKey] = {
    executedAt: new Date().toISOString(),
    ...details
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
 * Calcula la próxima franja horaria programada y los minutos restantes
 */
export function getNextSlotInfo() {
  const { hour, minute } = getCasablancaDate();
  const currentTotalMinutes = hour * 60 + minute;

  // Buscar el primer slot de hoy que aún no haya vencido
  const nextToday = SCHEDULE_SLOTS.find(s => {
    const slotTotalMinutes = s.hour * 60 + s.minute;
    return slotTotalMinutes > currentTotalMinutes;
  });

  if (nextToday) {
    const slotMinutes = nextToday.hour * 60 + nextToday.minute;
    const diff = slotMinutes - currentTotalMinutes;
    return {
      slot: nextToday,
      time: nextToday.time,
      type: nextToday.type,
      label: nextToday.label,
      isTomorrow: false,
      diffMinutes: Math.max(1, diff),
      badgeText: `Hoy a las ${nextToday.time} (en ${diff} min)`
    };
  }

  // Si ya pasaron todos los de hoy, la próxima es la primera de mañana
  const firstTomorrow = SCHEDULE_SLOTS[0];
  const diffTomorrow = (24 * 60 - currentTotalMinutes) + (firstTomorrow.hour * 60 + firstTomorrow.minute);
  return {
    slot: firstTomorrow,
    time: firstTomorrow.time,
    type: firstTomorrow.type,
    label: firstTomorrow.label,
    isTomorrow: true,
    diffMinutes: Math.max(1, diffTomorrow),
    badgeText: `Mañana a las ${firstTomorrow.time} (en ${Math.round(diffTomorrow / 60)}h)`
  };
}

/**
 * Obtiene el estado consolidado del programador para el Dashboard
 */
export function getSchedulerStatus() {
  const casablanca = getCasablancaDate();
  const next = getNextSlotInfo();
  const executed = getExecutedSlots();

  return {
    timezone: TIMEZONE,
    casablancaTime: `${casablanca.dateStr} ${casablanca.timeStr}`,
    currentTimeOnly: casablanca.timeStr,
    currentDateOnly: casablanca.dateStr,
    slots: SCHEDULE_SLOTS,
    nextSlot: next,
    isPublishing,
    lastExecution: lastExecutionInfo,
    executedToday: Object.keys(executed).filter(k => k.startsWith(casablanca.dateStr))
  };
}

/**
 * Inicia el programador resiliente para las 7 franjas
 * @param {Object} handlers - { onPublishFeed, onPublishStory }
 */
export function startScheduler(handlers = {}) {
  logger.info(`⏰ Programador resiliente iniciado. 7 franjas en ${TIMEZONE}:`);
  SCHEDULE_SLOTS.forEach(s => {
    logger.info(`   - ${s.time} ➔ [${s.type.toUpperCase()}] ${s.label}`);
  });

  const next = getNextSlotInfo();
  logger.info(`🎯 Próxima ejecución: ${next.badgeText} - ${next.label}`);

  checkInterval = setInterval(async () => {
    if (isPublishing) return;

    const cb = getCasablancaDate();
    const currentTotalMinutes = cb.hour * 60 + cb.minute;
    const executed = getExecutedSlots();

    // Heartbeat cada hora
    const hbKey = `${cb.dateStr}_${cb.hour}`;
    if (cb.minute === 0 && lastHeartbeatSlot !== hbKey) {
      lastHeartbeatSlot = hbKey;
      const n = getNextSlotInfo();
      logger.info(`💓 [Heartbeat] Hora Casablanca: ${cb.timeStr}. Próxima franja: ${n.badgeText} (${n.label})`);
    }

    // Comprobar si la hora y minuto coinciden con un slot
    for (const slot of SCHEDULE_SLOTS) {
      const slotTotalMinutes = slot.hour * 60 + slot.minute;
      const slotKey = `${cb.dateStr}_${slot.time}`;

      // Si estamos en la ventana de este slot (desde el minuto exacto hasta los siguientes 45 minutos)
      // y aún no ha sido ejecutado hoy
      if (currentTotalMinutes >= slotTotalMinutes && currentTotalMinutes < slotTotalMinutes + 50) {
        if (!executed[slotKey]) {
          isPublishing = true;
          const isFeed = slot.type === 'feed';
          logger.cron(`🚀 [Franja ${slot.time}] Ejecutando ${isFeed ? 'Post de Feed' : 'Story 2S1M'}: "${slot.label}"...`);

          try {
            let result;
            if (isFeed && typeof handlers.onPublishFeed === 'function') {
              result = await handlers.onPublishFeed();
            } else if (!isFeed && typeof handlers.onPublishStory === 'function') {
              result = await handlers.onPublishStory();
            }

            saveExecutedSlot(slotKey, {
              type: slot.type,
              status: 'success',
              title: result?.postSlug || result?.storySlug || slot.label
            });

            lastExecutionInfo = {
              slot: slot.time,
              type: slot.type,
              label: slot.label,
              timestamp: new Date().toISOString(),
              status: 'success',
              title: result?.postSlug || result?.storySlug || 'Publicación exitosa'
            };

            logger.success(`✅ [Franja ${slot.time}] ¡${isFeed ? 'Post' : 'Story'} publicado y renombrado en Drive!`);
          } catch (err) {
            lastExecutionInfo = {
              slot: slot.time,
              type: slot.type,
              label: slot.label,
              timestamp: new Date().toISOString(),
              status: 'error',
              error: err.message
            };
            logger.error(`❌ [Franja ${slot.time}] Error al publicar: ${err.message}`);
          } finally {
            isPublishing = false;
          }
          break;
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
