/**
 * Módulo de publicación para Meta Graph API (Facebook e Instagram - Feed y Stories)
 */

/**
 * Publica una foto y texto en la página de Facebook (Feed)
 */
export async function publishToFacebook(imageBuffer, caption) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken || accessToken.trim() === '') {
    console.warn('[Facebook] Credenciales no configuradas. Operando en MODO SIMULACIÓN.');
    return {
      simulated: true,
      postId: 'sim_fb_' + Math.random().toString(36).substr(2, 9),
      url: 'https://www.facebook.com/simulation'
    };
  }

  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substr(2, 16);
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${accessToken}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption || ''}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="post.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
  ];

  const headerBuffer = Buffer.from(parts.join(''));
  const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payloadBuffer = Buffer.concat([headerBuffer, imageBuffer, footerBuffer]);

  console.log(`[Facebook] Enviando publicación a la página ${pageId}...`);
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: payloadBuffer
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ? data.error.message : 'Error desconocido al subir foto a Facebook');
  }

  const postId = data.id || data.post_id;
  console.log(`[Facebook] Publicación exitosa en Facebook! Post ID: ${postId}`);
  return {
    simulated: false,
    postId,
    url: `https://www.facebook.com/${pageId}/posts/${postId}`
  };
}

/**
 * Publica una Story en la página de Facebook
 */
export async function publishToFacebookStory(imageBuffer) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken || accessToken.trim() === '') {
    return { simulated: true, postId: 'sim_fb_story_' + Date.now() };
  }

  console.log(`[Facebook Story] Subiendo imagen inédita a la página ${pageId}...`);
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substr(2, 16);
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${accessToken}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="published"\r\n\r\nfalse\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="story.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
  ];
  const payload = Buffer.concat([Buffer.from(parts.join('')), imageBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);

  const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: payload
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.id) {
    throw new Error(uploadData.error ? uploadData.error.message : 'Fallo al subir foto para Facebook Story');
  }

  const photoId = uploadData.id;
  console.log(`[Facebook Story] Foto subida (ID: ${photoId}). Publicando en Facebook Stories...`);

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photo_stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: accessToken, photo_id: photoId })
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || (!publishData.id && !publishData.post_id)) {
    throw new Error(publishData.error ? publishData.error.message : 'Fallo al publicar Story en Facebook');
  }

  const storyId = publishData.id || publishData.post_id;
  console.log(`[Facebook Story] ✅ Story publicada en Facebook! ID: ${storyId}`);
  return {
    simulated: false,
    postId: storyId,
    url: `https://www.facebook.com/${pageId}/stories`
  };
}

/**
 * Obtiene el ID de la cuenta de Instagram Business conectada a la página de Facebook
 */
export async function getInstagramAccountId() {
  if (process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCOUNT_ID.trim() !== '') {
    return process.env.INSTAGRAM_ACCOUNT_ID.trim();
  }

  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`);
  const data = await res.json();

  if (res.ok && data.instagram_business_account && data.instagram_business_account.id) {
    return data.instagram_business_account.id;
  }

  throw new Error(`No se encontró una cuenta de Instagram Business vinculada a la página de Facebook (${pageId}).`);
}

/**
 * Publica una foto y caption en el Feed de Instagram
 */
export async function publishToInstagram(publicImageUrl, caption) {
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!accessToken || accessToken.trim() === '') {
    return { simulated: true, postId: 'sim_ig_' + Date.now(), url: 'https://www.instagram.com/simulation' };
  }

  const igUserId = await getInstagramAccountId();
  console.log(`[Instagram Feed] Publicando en Instagram Feed ID: ${igUserId}...`);

  const createContainerUrl = new URL(`https://graph.facebook.com/v19.0/${igUserId}/media`);
  createContainerUrl.searchParams.append('image_url', publicImageUrl);
  if (caption) createContainerUrl.searchParams.append('caption', caption);
  createContainerUrl.searchParams.append('access_token', accessToken);

  const containerRes = await fetch(createContainerUrl.toString(), { method: 'POST' });
  const containerData = await containerRes.json();

  if (!containerRes.ok || !containerData.id) {
    throw new Error(containerData.error ? containerData.error.message : 'Fallo al crear contenedor multimedia en Instagram');
  }

  const creationId = containerData.id;
  console.log(`[Instagram Feed] Contenedor creado (ID: ${creationId}). Esperando procesamiento (3s)...`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  const publishUrl = new URL(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`);
  publishUrl.searchParams.append('creation_id', creationId);
  publishUrl.searchParams.append('access_token', accessToken);

  const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
  const publishData = await publishRes.json();

  if (!publishRes.ok || !publishData.id) {
    throw new Error(publishData.error ? publishData.error.message : 'Fallo al publicar contenedor en Instagram');
  }

  console.log(`[Instagram Feed] ✅ Publicación exitosa en Instagram Feed! Post ID: ${publishData.id}`);
  return {
    simulated: false,
    postId: publishData.id,
    url: `https://www.instagram.com/p/${publishData.id}`
  };
}

/**
 * Publica una Story en Instagram
 */
export async function publishToInstagramStory(publicImageUrl) {
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!accessToken || accessToken.trim() === '') {
    return { simulated: true, postId: 'sim_ig_story_' + Date.now(), url: 'https://www.instagram.com/stories' };
  }

  const igUserId = await getInstagramAccountId();
  console.log(`[Instagram Story] Creando contenedor de Story en Instagram...`);

  const containerParams = new URLSearchParams();
  containerParams.append('image_url', publicImageUrl);
  containerParams.append('media_type', 'STORIES');
  containerParams.append('access_token', accessToken);

  const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
    method: 'POST',
    body: containerParams
  });
  const containerData = await containerRes.json();

  if (!containerRes.ok || !containerData.id) {
    throw new Error(containerData.error ? containerData.error.message : 'Fallo al crear contenedor de Story en Instagram');
  }

  const creationId = containerData.id;
  console.log(`[Instagram Story] Contenedor creado (ID: ${creationId}). Esperando procesamiento...`);

  // Esperar a que el contenedor de Story esté listo
  let isReady = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${accessToken}`);
    const statusData = await statusRes.json();
    if (statusData.status_code === 'FINISHED') {
      isReady = true;
      break;
    } else if (statusData.status_code === 'ERROR') {
      throw new Error(`Meta falló procesando la Story en Instagram: ${JSON.stringify(statusData)}`);
    }
  }

  if (!isReady) {
    throw new Error('Timeout esperando el procesamiento de Story en Instagram');
  }

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: creationId, access_token: accessToken })
  });
  const publishData = await publishRes.json();

  if (!publishRes.ok || !publishData.id) {
    throw new Error(publishData.error ? publishData.error.message : 'Fallo al publicar Story en Instagram');
  }

  console.log(`[Instagram Story] ✅ Story publicada en Instagram! ID: ${publishData.id}`);
  return {
    simulated: false,
    postId: publishData.id,
    url: `https://www.instagram.com/stories`
  };
}

/**
 * Publica un Post exclusivamente en los Feeds de Facebook e Instagram
 */
export async function publishFeedPost({ imageBuffer, publicImageUrl, caption }) {
  const results = {
    facebook: null,
    instagram: null,
    errors: []
  };

  // 1. Facebook Feed
  try {
    results.facebook = await publishToFacebook(imageBuffer, caption);
  } catch (err) {
    console.error('[Facebook Error]', err.message);
    results.errors.push(`Facebook Feed: ${err.message}`);
  }

  // 2. Instagram Feed
  try {
    results.instagram = await publishToInstagram(publicImageUrl, caption);
  } catch (err) {
    console.error('[Instagram Error]', err.message);
    results.errors.push(`Instagram Feed: ${err.message}`);
  }

  if (!results.facebook && !results.instagram) {
    throw new Error(`Falló la publicación en las redes principales: ${results.errors.join(' | ')}`);
  }

  return results;
}

/**
 * Publica una Story vertical exclusiva en las Stories de Facebook e Instagram
 */
export async function publishDedicatedStory({ imageBuffer, publicImageUrl }) {
  const results = {
    facebookStory: null,
    instagramStory: null,
    errors: []
  };

  // 1. Facebook Story
  try {
    results.facebookStory = await publishToFacebookStory(imageBuffer);
  } catch (err) {
    console.error('[Facebook Story Error]', err.message);
    results.errors.push(`Facebook Story: ${err.message}`);
  }

  // 2. Instagram Story
  try {
    results.instagramStory = await publishToInstagramStory(publicImageUrl);
  } catch (err) {
    console.error('[Instagram Story Error]', err.message);
    results.errors.push(`Instagram Story: ${err.message}`);
  }

  if (!results.facebookStory && !results.instagramStory) {
    throw new Error(`Falló la publicación de Story: ${results.errors.join(' | ')}`);
  }

  return results;
}

/**
 * Compatibilidad hacia atrás
 */
export async function publishPost({ imageBuffer, publicImageUrl, caption, publishStory = false }) {
  const feedResults = await publishFeedPost({ imageBuffer, publicImageUrl, caption });
  let storyResults = { facebookStory: null, instagramStory: null };

  if (publishStory) {
    try {
      storyResults = await publishDedicatedStory({ imageBuffer, publicImageUrl });
    } catch (e) {
      console.warn('[Story Warning]', e.message);
    }
  }

  return {
    ...feedResults,
    ...storyResults
  };
}
