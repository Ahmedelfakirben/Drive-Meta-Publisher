import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getPendingFeedPosts,
  getPendingStories,
  readDocText,
  downloadFile,
  getPublicDriveImageUrl,
  markPostAsPublished,
  markStoryAsPublished
} from './drive.js';
import { publishFeedPost, publishDedicatedStory } from './publisher.js';
import { createServer } from './server.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, '..', 'temp');
const HISTORY_PATH = path.resolve(__dirname, '..', 'data', 'history.json');

function saveToHistory(entry) {
  try {
    let history = [];
    if (fs.existsSync(HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    }
    history.unshift({
      ...entry,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(0, 60), null, 2));
  } catch (e) {
    logger.error(`[History Error] ${e.message}`);
  }
}

/**
 * 1. Procesa y publica el siguiente Post de Feed (1:1 Cuadrado con Texto)
 */
export async function processNextFeedPost() {
  logger.info(`🔍 [Feed] Buscando posts pendientes de Feed en Google Drive ("Post *")...`);

  const pending = await getPendingFeedPosts();
  if (pending.length === 0) {
    logger.warn('ℹ️ [Feed] No hay posts pendientes que empiecen por "Post" en Google Drive.');
    return { status: 'empty', message: 'No hay posts de feed pendientes' };
  }

  // Tomar el primero que tenga foto y doc si es posible
  const readyPosts = pending.filter(p => p.imageFile && p.docFile);
  const post = readyPosts.length > 0 ? readyPosts[0] : pending[0];
  logger.info(`📦 [Feed] Procesando: "${post.postSlug}" (${pending.length} en cola)`);

  let caption = '';
  if (post.docFile) {
    logger.info(`📄 [Feed] Leyendo texto bilingüe desde: "${post.docFile.name}"...`);
    caption = await readDocText(post.docFile);
  } else {
    logger.warn(`⚠️ [Feed] Sin doc emparejado para "${post.imageFile.name}".`);
  }

  const safeFilename = `feed_${Date.now()}_${post.imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const localImagePath = path.join(TEMP_DIR, safeFilename);

  logger.info(`⬇️ [Feed] Descargando imagen "${post.imageFile.name}"...`);
  await downloadFile(post.imageFile.id, localImagePath);
  const imageBuffer = await fs.promises.readFile(localImagePath);

  let publicImageUrl;
  try {
    publicImageUrl = await getPublicDriveImageUrl(post.imageFile.id);
  } catch (err) {
    const publicBaseUrl = (process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3050}`).replace(/\/$/, '');
    publicImageUrl = `${publicBaseUrl}/media/${safeFilename}`;
  }

  logger.info(`🚀 [Feed] Publicando en Facebook Feed e Instagram Feed...`);
  let publishResult;
  try {
    publishResult = await publishFeedPost({
      imageBuffer,
      publicImageUrl,
      caption
    });
  } catch (pubErr) {
    logger.error(`❌ [Feed] Error al publicar: ${pubErr.message}`);
    if (fs.existsSync(localImagePath)) await fs.promises.unlink(localImagePath).catch(() => {});
    throw pubErr;
  }

  logger.info(`🏷️ [Feed] Renombrando archivos en Drive a [PUBLICADO]...`);
  await markPostAsPublished(post);

  if (fs.existsSync(localImagePath)) {
    await fs.promises.unlink(localImagePath).catch(() => {});
  }

  logger.success(`🎉 ¡Post de Feed publicado exitosamente: "${post.postSlug}"!`);
  if (publishResult.facebook) logger.success(`   📘 Facebook: ${publishResult.facebook.url}`);
  if (publishResult.instagram) logger.success(`   📸 Instagram: ${publishResult.instagram.url}`);

  saveToHistory({
    type: 'feed',
    postSlug: post.postSlug,
    facebookUrl: publishResult.facebook ? publishResult.facebook.url : null,
    instagramUrl: publishResult.instagram ? publishResult.instagram.url : null,
    facebookStory: false,
    instagramStory: false
  });

  return {
    status: 'success',
    postSlug: post.postSlug,
    results: publishResult
  };
}

/**
 * 2. Procesa y publica la siguiente Story dedicada (9:16 Vertical exclusiva)
 */
export async function processNextStory() {
  logger.info(`🔍 [Story] Buscando stories pendientes en Google Drive ("Stories 2s1m *")...`);

  const pending = await getPendingStories();
  if (pending.length === 0) {
    logger.warn('ℹ️ [Story] No hay stories pendientes que empiecen por "Stories 2s1m" en Google Drive.');
    return { status: 'empty', message: 'No hay stories pendientes' };
  }

  const story = pending[0];
  logger.info(`⚡ [Story] Procesando Story vertical: "${story.storySlug}" (${pending.length} en cola)`);

  const safeFilename = `story_${Date.now()}_${story.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const localImagePath = path.join(TEMP_DIR, safeFilename);

  logger.info(`⬇️ [Story] Descargando imagen vertical "${story.name}"...`);
  await downloadFile(story.id, localImagePath);
  const imageBuffer = await fs.promises.readFile(localImagePath);

  let publicImageUrl;
  try {
    publicImageUrl = await getPublicDriveImageUrl(story.id);
  } catch (err) {
    const publicBaseUrl = (process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3050}`).replace(/\/$/, '');
    publicImageUrl = `${publicBaseUrl}/media/${safeFilename}`;
  }

  logger.info(`🚀 [Story] Publicando en Facebook Stories e Instagram Stories a pantalla completa...`);
  let publishResult;
  try {
    publishResult = await publishDedicatedStory({
      imageBuffer,
      publicImageUrl
    });
  } catch (pubErr) {
    logger.error(`❌ [Story] Error al publicar Story: ${pubErr.message}`);
    if (fs.existsSync(localImagePath)) await fs.promises.unlink(localImagePath).catch(() => {});
    throw pubErr;
  }

  logger.info(`🏷️ [Story] Renombrando archivo en Drive a [PUBLICADO]...`);
  await markStoryAsPublished(story);

  if (fs.existsSync(localImagePath)) {
    await fs.promises.unlink(localImagePath).catch(() => {});
  }

  logger.success(`🎉 ¡Story 2S1M publicada exitosamente: "${story.storySlug}"!`);

  saveToHistory({
    type: 'story',
    postSlug: story.storySlug,
    facebookUrl: null,
    instagramUrl: null,
    facebookStory: !!publishResult.facebookStory,
    instagramStory: !!publishResult.instagramStory
  });

  return {
    status: 'success',
    storySlug: story.storySlug,
    results: publishResult
  };
}

// -------------------------------------------------------------
// Inicialización del servicio y servidor Express
// -------------------------------------------------------------
const PORT = process.env.PORT || 3050;
const app = createServer({
  onPublishFeed: processNextFeedPost,
  onPublishStory: processNextStory,
  onManualPublish: processNextFeedPost
});

app.listen(PORT, async () => {
  logger.info(`===========================================================`);
  logger.info(`🚀 2S1M Auto-Publisher 3 Posts + 4 Stories iniciado (Port ${PORT})`);
  logger.info(`🌐 Panel de Control: http://localhost:${PORT}`);
  logger.info(`===========================================================`);

  // Iniciar el programador de las 7 franjas
  startScheduler({
    onPublishFeed: processNextFeedPost,
    onPublishStory: processNextStory
  });

  // CLI triggers
  if (process.argv.includes('--feed-now')) {
    logger.info('[CLI] Publicando Post de Feed inmediato...');
    await processNextFeedPost().catch(e => logger.error(e.message));
  } else if (process.argv.includes('--story-now')) {
    logger.info('[CLI] Publicando Story inmediata...');
    await processNextStory().catch(e => logger.error(e.message));
  } else if (process.argv.includes('--now')) {
    logger.info('[CLI] Argumento --now detectado. Ejecutando post...');
    await processNextFeedPost().catch(e => logger.error(e.message));
  }
});
