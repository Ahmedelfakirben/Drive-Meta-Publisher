import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getPendingPosts, readDocText, downloadFile, getPublicDriveImageUrl, markPostAsPublished } from './drive.js';
import { publishPost } from './publisher.js';
import { createServer } from './server.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, '..', 'temp');

/**
 * Procesa y publica la siguiente publicación disponible en la cola de Google Drive
 */
export async function processNextPost() {
  logger.info(`🔍 Buscando publicaciones pendientes en Google Drive...`);

  // 1. Obtener lista de publicaciones pendientes
  let pending;
  try {
    pending = await getPendingPosts();
  } catch (driveErr) {
    logger.error(`❌ Error al conectar con Google Drive: ${driveErr.message}`);
    throw driveErr;
  }

  if (pending.length === 0) {
    logger.warn('ℹ️ No hay publicaciones pendientes que empiecen por "Post" en Google Drive.');
    return { status: 'empty', message: 'No hay publicaciones pendientes' };
  }

  // 2. Tomar el primer post que tenga foto Y documento listo
  const readyPosts = pending.filter(p => p.imageFile && p.docFile);
  const post = readyPosts.length > 0 ? readyPosts[0] : pending[0];
  logger.info(`📦 Seleccionado para publicar: "${post.postSlug}" (${readyPosts.length} posts listos con foto y doc)`);

  // 3. Leer el texto del post desde el Google Doc o .txt emparejado
  let caption = '';
  if (post.docFile) {
    logger.info(`📄 Leyendo contenido del texto desde: "${post.docFile.name}"...`);
    caption = await readDocText(post.docFile);
  } else {
    logger.warn(`⚠️ No se encontró documento de texto emparejado con "${post.imageFile.name}". Se publicará solo con imagen.`);
  }

  // 4. Descargar la imagen temporalmente para publicarla
  const safeFilename = `post_${Date.now()}_${post.imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const localImagePath = path.join(TEMP_DIR, safeFilename);

  logger.info(`⬇️ Descargando imagen "${post.imageFile.name}"...`);
  await downloadFile(post.imageFile.id, localImagePath);

  const imageBuffer = await fs.promises.readFile(localImagePath);

  // 5. Construir URL pública para la API de Instagram usando CDN directo de Google Drive
  let publicImageUrl;
  try {
    publicImageUrl = await getPublicDriveImageUrl(post.imageFile.id);
    logger.info(`🌐 Imagen vinculada a Google CDN para Instagram: ${publicImageUrl.slice(0, 45)}...`);
  } catch (urlErr) {
    const publicBaseUrl = (process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3050}`).replace(/\/$/, '');
    publicImageUrl = `${publicBaseUrl}/media/${safeFilename}`;
    logger.info(`🌐 Usando URL local pública de respaldo: ${publicImageUrl}`);
  }

  // 6. Publicar en Facebook e Instagram (Feed y Stories)
  logger.info(`🚀 Enviando a Meta Graph API (Facebook Feed, Instagram Feed, Stories)...`);
  let publishResult;
  try {
    publishResult = await publishPost({
      imageBuffer,
      publicImageUrl,
      caption,
      publishStory: process.env.PUBLISH_STORIES !== 'false'
    });
  } catch (pubErr) {
    logger.error(`❌ Error durante la publicación en Meta: ${pubErr.message}`);
    if (fs.existsSync(localImagePath)) {
      await fs.promises.unlink(localImagePath).catch(() => {});
    }
    throw pubErr;
  }

  // 7. Marcar como publicado en Google Drive (renombrando con [PUBLICADO])
  logger.info(`🏷️ Renombrando archivos en Google Drive con prefijo [PUBLICADO]...`);
  await markPostAsPublished(post);

  // 8. Limpiar archivo temporal de imagen local
  if (fs.existsSync(localImagePath)) {
    await fs.promises.unlink(localImagePath).catch(() => {});
  }

  logger.success(`🎉 ¡Publicación exitosa de "${post.postSlug}"!`);
  if (publishResult.facebook) logger.success(`   📘 Facebook Feed: ${publishResult.facebook.url}`);
  if (publishResult.instagram) logger.success(`   📸 Instagram Feed: ${publishResult.instagram.url}`);
  if (publishResult.facebookStory) logger.success(`   ⚡ Facebook Story publicada`);
  if (publishResult.instagramStory) logger.success(`   ⚡ Instagram Story publicada`);

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
    logger.error(`[History Error] ${e.message}`);
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
  logger.info(`===========================================================`);
  logger.info(`🚀 2S1M Drive-Meta-Publisher arrancado en puerto ${PORT}`);
  logger.info(`🌐 Panel de control: http://localhost:${PORT}`);
  logger.info(`===========================================================`);

  // Iniciar el programador resiliente
  startScheduler(processNextPost);

  // Si se invocó con argumento --now, ejecutar inmediatamente
  if (process.argv.includes('--now')) {
    logger.info('[CLI] Argumento --now detectado. Ejecutando publicación inmediata...');
    try {
      await processNextPost();
    } catch (err) {
      logger.error(`[CLI Error] ${err.message}`);
    }
  }
});
