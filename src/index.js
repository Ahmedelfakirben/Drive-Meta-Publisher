import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { getPendingPosts, readDocText, downloadFile, getPublicDriveImageUrl, markPostAsPublished } from './drive.js';
import { publishPost } from './publisher.js';
import { createServer } from './server.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, '..', 'temp');

/**
 * Procesa y publica la siguiente publicación disponible en la cola de Google Drive
 */
export async function processNextPost() {
  console.log('===========================================================');
  console.log(`[Auto-Publisher] 🔍 Revisando Google Drive a las: ${new Date().toLocaleString()}`);
  console.log('===========================================================');

  // 1. Obtener lista de publicaciones pendientes
  const pending = await getPendingPosts();

  if (pending.length === 0) {
    console.log('[Auto-Publisher] ℹ️ No hay publicaciones pendientes en Google Drive.');
    return { status: 'empty', message: 'No hay publicaciones pendientes' };
  }

  // 2. Tomar el primer post que tenga foto Y documento listo
  const readyPosts = pending.filter(p => p.imageFile && p.docFile);
  const post = readyPosts.length > 0 ? readyPosts[0] : pending[0];
  console.log(`[Auto-Publisher] 📦 Procesando publicación: "${post.postSlug}"...`);

  // 3. Leer el texto del post desde el Google Doc o .txt emparejado
  let caption = '';
  if (post.docFile) {
    console.log(`[Auto-Publisher] 📄 Leyendo texto desde: "${post.docFile.name}"...`);
    caption = await readDocText(post.docFile);
  } else {
    console.warn(`[Auto-Publisher] ⚠️ No se encontró documento de texto emparejado con "${post.imageFile.name}".`);
  }

  // 4. Descargar la imagen temporalmente para publicarla
  const safeFilename = `post_${Date.now()}_${post.imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const localImagePath = path.join(TEMP_DIR, safeFilename);

  console.log(`[Auto-Publisher] ⬇️ Descargando imagen "${post.imageFile.name}" a cache temporal...`);
  await downloadFile(post.imageFile.id, localImagePath);

  const imageBuffer = await fs.promises.readFile(localImagePath);

  // 5. Construir URL pública para la API de Instagram usando CDN directo de Google Drive
  let publicImageUrl;
  try {
    publicImageUrl = await getPublicDriveImageUrl(post.imageFile.id);
    console.log(`[Auto-Publisher] 🌐 URL pública de Google CDN para Instagram: ${publicImageUrl}`);
  } catch (urlErr) {
    const publicBaseUrl = (process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3050}`).replace(/\/$/, '');
    publicImageUrl = `${publicBaseUrl}/media/${safeFilename}`;
    console.log(`[Auto-Publisher] 🌐 Fallback URL local para Instagram: ${publicImageUrl}`);
  }

  // 6. Publicar en Facebook e Instagram
  let publishResult;
  try {
    publishResult = await publishPost({
      imageBuffer,
      publicImageUrl,
      caption,
      publishStory: process.env.PUBLISH_STORIES !== 'false'
    });
  } catch (pubErr) {
    console.error(`[Auto-Publisher] ❌ Error durante la publicación:`, pubErr.message);
    if (fs.existsSync(localImagePath)) {
      await fs.promises.unlink(localImagePath).catch(() => {});
    }
    throw pubErr;
  }

  // 7. Marcar como publicado en Google Drive (renombrando con [PUBLICADO])
  console.log(`[Auto-Publisher] 🏷️ Marcando archivos como publicados en Google Drive...`);
  await markPostAsPublished(post);

  // 8. Limpiar archivo temporal de imagen local
  if (fs.existsSync(localImagePath)) {
    await fs.promises.unlink(localImagePath).catch(() => {});
  }

  console.log('===========================================================');
  console.log(`[Auto-Publisher] ✅ ¡PUBLICACIÓN COMPLETADA CON ÉXITO!`);
  console.log(`- Post procesado: ${post.postSlug}`);
  if (publishResult.facebook) console.log(`- Facebook Feed: ${publishResult.facebook.url}`);
  if (publishResult.instagram) console.log(`- Instagram Feed: ${publishResult.instagram.url}`);
  if (publishResult.facebookStory) console.log(`- Facebook Story: ${publishResult.facebookStory.url}`);
  if (publishResult.instagramStory) console.log(`- Instagram Story: ${publishResult.instagramStory.url}`);
  console.log('===========================================================');

  // Guardar en historial local
  const historyPath = path.resolve(__dirname, '..', 'data', 'history.json');
  try {
    let history = [];
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }
    history.unshift({
      postSlug: post.postSlug,
      timestamp: new Date().toISOString(),
      facebookUrl: publishResult.facebook ? publishResult.facebook.url : null,
      instagramUrl: publishResult.instagram ? publishResult.instagram.url : null,
      facebookStory: !!publishResult.facebookStory,
      instagramStory: !!publishResult.instagramStory
    });
    fs.writeFileSync(historyPath, JSON.stringify(history.slice(0, 50), null, 2));
  } catch (e) {
    console.error('[History Error]', e.message);
  }

  return {
    status: 'success',
    postSlug: post.postSlug,
    results: publishResult,
    message: `Post y Story "${post.postSlug}" publicados y marcados correctamente`
  };
}

// -------------------------------------------------------------
// Inicialización del servicio y servidor Express
// -------------------------------------------------------------
const PORT = process.env.PORT || 3050;
const app = createServer({
  onManualPublish: processNextPost
});

app.listen(PORT, async () => {
  console.log('===========================================================');
  console.log(`🚀 2S1M Drive-Meta-Publisher arrancado en puerto ${PORT}`);
  console.log(`🌐 Panel de estado local: http://localhost:${PORT}`);
  console.log('===========================================================');

  // Programación Cron
  const cronExpression = process.env.CRON_SCHEDULE || '0 13 * * *';
  const timezone = process.env.TIMEZONE || 'Africa/Casablanca';

  cron.schedule(cronExpression, async () => {
    try {
      await processNextPost();
    } catch (err) {
      console.error('[Cron Error] Fallo al ejecutar la tarea programada:', err.message);
    }
  }, {
    timezone: timezone
  });

  console.log(`⏰ Cron programado con expresión: "${cronExpression}" (Zona horaria: ${timezone})`);

  // Si se invocó con argumento --now, ejecutar inmediatamente
  if (process.argv.includes('--now')) {
    console.log('[CLI] Argumento --now detectado. Ejecutando publicación inmediata...');
    try {
      await processNextPost();
    } catch (err) {
      console.error('[CLI Error]', err.message);
    }
  }
});
