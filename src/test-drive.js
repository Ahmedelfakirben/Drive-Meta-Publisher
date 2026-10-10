import dotenv from 'dotenv';
import { getDriveClient, getPendingPosts } from './drive.js';

dotenv.config();

async function testDrive() {
  console.log('===========================================================');
  console.log('🧪 Probando conexión con Google Drive (Modo Archivos Sueltos)...');
  console.log('===========================================================');

  try {
    const drive = await getDriveClient();
    console.log('✅ Autenticación con Google Service Account: EXITOSA');

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      console.warn('⚠️ GOOGLE_DRIVE_FOLDER_ID está vacío en .env.');
      return;
    }

    console.log(`🔍 Inspeccionando carpeta raíz ID: ${folderId}...`);
    const rootInfo = await drive.files.get({ fileId: folderId, fields: 'id, name' });
    console.log(`📁 Carpeta encontrada en Drive: "${rootInfo.data.name}"`);

    const pending = await getPendingPosts(folderId);
    console.log(`\n📦 Publicaciones pendientes encontradas: ${pending.length}`);

    pending.forEach((post, i) => {
      console.log(`  ${i + 1}. [Post] "${post.postSlug}"`);
      console.log(`     - Foto: ${post.imageFile.name}`);
      console.log(`     - Documento: ${post.docFile ? `${post.docFile.name} (${post.docFile.isGoogleDoc ? 'Google Doc' : 'Texto plano'})` : '⚠️ NINGUNO (Falta doc con el mismo nombre)'}`);
    });

    console.log('\n===========================================================');
    console.log('✅ ¡Todo funciona correctamente con Google Drive!');
    console.log('===========================================================');
  } catch (err) {
    console.error('\n❌ ERROR durante la prueba de Google Drive:');
    console.error(err.message);
  }
}

testDrive();
