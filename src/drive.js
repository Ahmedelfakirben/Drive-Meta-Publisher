import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOAuth2Client, isGoogleAuthenticated } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccountClient = null;

/**
 * Inicializa y autentica el cliente de Google Drive
 */
export async function getDriveClient() {
  if (isGoogleAuthenticated()) {
    const oauthClient = getOAuth2Client();
    return google.drive({ version: 'v3', auth: oauthClient });
  }

  if (serviceAccountClient) return serviceAccountClient;

  let auth;
  if (process.env.GDRIVE_CLIENT_EMAIL && process.env.GDRIVE_PRIVATE_KEY) {
    const formattedPrivateKey = process.env.GDRIVE_PRIVATE_KEY.replace(/\\n/g, '\n');
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GDRIVE_CLIENT_EMAIL.trim(),
        private_key: formattedPrivateKey
      },
      scopes: ['https://www.googleapis.com/auth/drive']
    });
  } else {
    const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'credentials/service-account.json';
    const resolvedPath = path.isAbsolute(keyFilePath)
      ? keyFilePath
      : path.resolve(__dirname, '..', keyFilePath);

    if (fs.existsSync(resolvedPath)) {
      auth = new google.auth.GoogleAuth({
        keyFile: resolvedPath,
        scopes: ['https://www.googleapis.com/auth/drive']
      });
    }
  }

  if (auth) {
    serviceAccountClient = google.drive({ version: 'v3', auth });
    return serviceAccountClient;
  }

  throw new Error('No hay autenticación activa con Google Drive.');
}

/**
 * Obtiene el nombre base limpio de un archivo (sin extensión y sin espacios extra)
 */
function getBaseName(filename) {
  return filename
    .replace(/\.[^/.]+$/, '')
    .trim()
    .toLowerCase();
}

/**
 * Obtiene la lista de publicaciones para el Feed pendientes en Google Drive
 * REGLA ESTRICTA:
 * - El nombre DEBE empezar por "Post" (ej: Post 1, Post 2, Post 3)
 * - Debe ser imagen (.jpg, .jpeg, .png) o documento (Google Doc o .txt)
 * - Ignora todo lo que empiece por [PUBLICADO]
 */
export async function getPendingPosts() {
  const drive = await getDriveClient();

  // Buscar archivos que contengan 'Post' directamente en la API de Google Drive
  const res = await drive.files.list({
    q: "trashed = false and name contains 'Post'",
    fields: 'files(id, name, mimeType, size, createdTime)',
    pageSize: 100,
    orderBy: 'name'
  });

  const allFiles = res.data.files || [];

  // 1. Filtrar estrictamente:
  // - Debe empezar por "Post" (ej: Post 1, Post 2, etc.)
  // - NO debe empezar por [PUBLICADO] ni [ERROR]
  const postFiles = allFiles.filter(f => {
    const name = f.name.trim();
    if (name.startsWith('[PUBLICADO]') || name.startsWith('[ERROR]')) return false;
    return /^post\s*\d*[\s_-]/i.test(name) || name.toLowerCase().startsWith('post');
  });

  // 2. Separar imágenes y documentos
  const imageFiles = postFiles.filter(f =>
    f.mimeType.startsWith('image/') ||
    /\.(jpe?g|png|webp)$/i.test(f.name)
  );

  const docFiles = postFiles.filter(f =>
    f.mimeType === 'application/vnd.google-apps.document' ||
    f.mimeType.startsWith('text/') ||
    /\.(txt|docx?)$/i.test(f.name)
  );

  const pendingPosts = [];

  for (const img of imageFiles) {
    const imgBase = getBaseName(img.name);

    // Buscar documento que comparta el mismo nombre base
    const matchingDoc = docFiles.find(d => getBaseName(d.name) === imgBase);

    pendingPosts.push({
      postSlug: img.name.replace(/\.[^/.]+$/, '').trim(),
      imageFile: {
        id: img.id,
        name: img.name,
        mimeType: img.mimeType
      },
      docFile: matchingDoc ? {
        id: matchingDoc.id,
        name: matchingDoc.name,
        mimeType: matchingDoc.mimeType,
        isGoogleDoc: matchingDoc.mimeType === 'application/vnd.google-apps.document'
      } : null
    });
  }

  // Ordenar numéricamente y alfabéticamente (Post 1, Post 2, Post 3...)
  pendingPosts.sort((a, b) => {
    const numA = (a.postSlug.match(/\d+/) || [0])[0];
    const numB = (b.postSlug.match(/\d+/) || [0])[0];
    if (numA !== numB) return Number(numA) - Number(numB);
    return a.postSlug.localeCompare(b.postSlug);
  });

  return pendingPosts;
}

export const getPendingFeedPosts = getPendingPosts;

/**
 * Obtiene la lista de Stories dedicadas pendientes en Google Drive
 * REGLA ESTRICTA:
 * - El nombre DEBE empezar por "Stories 2s1m" (ej: Stories 2s1m - 1 - ..., Stories 2s1m - 2 - ...)
 * - Formato vertical (9:16) .jpg, .jpeg, .png
 * - Ignora todo lo que empiece por [PUBLICADO]
 */
export async function getPendingStories() {
  const drive = await getDriveClient();

  const res = await drive.files.list({
    q: "trashed = false and name contains 'Stor'",
    fields: 'files(id, name, mimeType, size, createdTime)',
    pageSize: 100,
    orderBy: 'name'
  });

  const allFiles = res.data.files || [];

  const storyFiles = allFiles.filter(f => {
    const name = f.name.trim();
    if (name.startsWith('[PUBLICADO]') || name.startsWith('[ERROR]')) return false;
    const isImage = f.mimeType.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(name);
    return isImage && /^stor(y|ies)\s*2s1m/i.test(name);
  });

  const pendingStories = storyFiles.map(f => ({
    id: f.id,
    name: f.name,
    storySlug: f.name.replace(/\.[^/.]+$/, '').trim(),
    mimeType: f.mimeType
  }));

  // Ordenar numéricamente: Stories 2s1m - 1, Stories 2s1m - 2, etc.
  pendingStories.sort((a, b) => {
    const numA = (a.storySlug.match(/\d+/) || [0])[0];
    const numB = (b.storySlug.match(/\d+/) || [0])[0];
    if (numA !== numB) return Number(numA) - Number(numB);
    return a.storySlug.localeCompare(b.storySlug);
  });

  return pendingStories;
}

/**
 * Lee el texto de un documento de Google Drive (Soporta Google Docs y .txt)
 * Limpia automáticamente tablas de parámetros de Spark extrayendo el contenido publicitario real.
 */
export async function readDocText(docInfo) {
  if (!docInfo || !docInfo.id) return '';
  const drive = await getDriveClient();

  let raw = '';
  if (docInfo.isGoogleDoc) {
    const res = await drive.files.export(
      { fileId: docInfo.id, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    raw = typeof res.data === 'string' ? res.data : String(res.data);
  } else {
    const res = await drive.files.get(
      { fileId: docInfo.id, alt: 'media' },
      { responseType: 'text' }
    );
    raw = typeof res.data === 'string' ? res.data : String(res.data);
  }

  let cleanText = raw.replace(/^\uFEFF/, '').trim();

  // Si Spark incluye una tabla técnica antes de la publicación, extraer a partir del texto real
  const markers = ['Caption Content', 'Contenido del Post:', 'Caption:', 'Texto del post:'];
  for (const marker of markers) {
    if (cleanText.includes(marker)) {
      const parts = cleanText.split(marker);
      cleanText = parts[1].trim();
      break;
    }
  }

  return cleanText;
}

/**
 * Descarga una imagen de Google Drive a una ruta local temporal
 */
export async function downloadFile(fileId, destinationPath) {
  const drive = await getDriveClient();
  const dir = path.dirname(destinationPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const destStream = fs.createWriteStream(destinationPath);

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    res.data
      .pipe(destStream)
      .on('finish', () => resolve(destinationPath))
      .on('error', reject);
  });
}

/**
 * Hace que el archivo de imagen sea accesible públicamente y devuelve la URL CDN de Google
 * Esto permite que Meta / Instagram descargue la foto directamente desde los servidores de Google
 */
export async function getPublicDriveImageUrl(fileId) {
  const drive = await getDriveClient();
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
  } catch (err) {
    // Si ya tiene permisos heredados, continuar
  }

  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

/**
 * Marca el post de Feed como publicado en Google Drive:
 * Renombra la imagen y el documento a "[PUBLICADO] Post..."
 */
export async function markPostAsPublished(post) {
  const drive = await getDriveClient();

  if (post.imageFile && post.imageFile.id) {
    const newImageName = `[PUBLICADO] ${post.imageFile.name}`;
    try {
      await drive.files.update({
        fileId: post.imageFile.id,
        requestBody: { name: newImageName }
      });
      console.log(`[Drive] Imagen renombrada a: "${newImageName}"`);
    } catch (err) {
      console.error(`[Drive] Error al renombrar imagen:`, err.message);
    }
  }

  if (post.docFile && post.docFile.id) {
    const newDocName = `[PUBLICADO] ${post.docFile.name}`;
    try {
      await drive.files.update({
        fileId: post.docFile.id,
        requestBody: { name: newDocName }
      });
      console.log(`[Drive] Documento renombrado a: "${newDocName}"`);
    } catch (err) {
      console.error(`[Drive] Error al renombrar documento:`, err.message);
    }
  }
}

/**
 * Marca una Story como publicada en Google Drive:
 * Renombra el archivo a "[PUBLICADO] Stories 2s1m..."
 */
export async function markStoryAsPublished(story) {
  const drive = await getDriveClient();

  if (story && story.id) {
    const newName = `[PUBLICADO] ${story.name}`;
    try {
      await drive.files.update({
        fileId: story.id,
        requestBody: { name: newName }
      });
      console.log(`[Drive] Story renombrada a: "${newName}"`);
    } catch (err) {
      console.error(`[Drive] Error al renombrar Story:`, err.message);
    }
  }
}
