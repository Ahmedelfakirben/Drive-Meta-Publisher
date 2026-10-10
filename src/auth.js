import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_TOKENS_PATH = path.resolve(__dirname, '..', 'tokens.json');
const DATA_TOKENS_PATH = path.resolve(__dirname, '..', 'data', 'tokens.json');

function getTokensPath() {
  if (fs.existsSync(DATA_TOKENS_PATH)) return DATA_TOKENS_PATH;
  if (fs.existsSync(ROOT_TOKENS_PATH)) return ROOT_TOKENS_PATH;
  return DATA_TOKENS_PATH;
}

let oauth2ClientInstance = null;

/**
 * Obtiene el cliente OAuth2 configurado con las credenciales de Google
 */
export function getOAuth2Client() {
  if (oauth2ClientInstance) return oauth2ClientInstance;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_SERVER_URL || 'http://localhost:3050'}/auth/callback`;

  if (!clientId || !clientSecret) {
    return null;
  }

  oauth2ClientInstance = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  // Cargar tokens guardados si existen
  if (fs.existsSync(getTokensPath())) {
    try {
      const tokens = JSON.parse(fs.readFileSync(getTokensPath(), 'utf-8'));
      oauth2ClientInstance.setCredentials(tokens);

      // Guardar tokens actualizados cuando se refresquen
      oauth2ClientInstance.on('tokens', (newTokens) => {
        const merged = { ...tokens, ...newTokens };
        fs.writeFileSync(getTokensPath(), JSON.stringify(merged, null, 2));
      });
    } catch (e) {
      console.error('[Auth] Error al leer tokens.json:', e.message);
    }
  }

  return oauth2ClientInstance;
}

/**
 * Verifica si ya hay una sesión de Google activa con tokens válidos
 */
export function isGoogleAuthenticated() {
  const client = getOAuth2Client();
  if (!client) return false;
  return !!(client.credentials && (client.credentials.access_token || client.credentials.refresh_token));
}

/**
 * Genera la URL de autorización para iniciar sesión con Google
 */
export function getAuthUrl() {
  const client = getOAuth2Client();
  if (!client) {
    throw new Error('Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env');
  }

  return client.generateAuthUrl({
    access_type: 'offline', // Imprescindible para obtener refresh_token y no caducar nunca
    prompt: 'consent',      // Garantiza que devuelva el refresh_token
    scope: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });
}

/**
 * Procesa el código devuelto por Google y guarda los tokens
 */
export async function handleAuthCallback(code) {
  const client = getOAuth2Client();
  if (!client) throw new Error('Cliente OAuth2 no inicializado');

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(getTokensPath(), JSON.stringify(tokens, null, 2));
  console.log('[Auth] ✅ Tokens de Google guardados exitosamente en tokens.json');

  return tokens;
}

/**
 * Obtiene la información del usuario conectado (email y nombre)
 */
export async function getGoogleUserInfo() {
  if (!isGoogleAuthenticated()) return null;
  const client = getOAuth2Client();
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    return {
      email: data.email,
      name: data.name,
      picture: data.picture
    };
  } catch (err) {
    return null;
  }
}

/**
 * Cierra la sesión borrando tokens.json
 */
export function logoutGoogle() {
  if (fs.existsSync(getTokensPath())) {
    fs.unlinkSync(getTokensPath());
  }
  if (oauth2ClientInstance) {
    oauth2ClientInstance.setCredentials({});
  }
  console.log('[Auth] Sesión de Google cerrada.');
}
