# 🚗 2S1M Drive-Meta-Publisher

Sistema autónomo para publicar automáticamente imágenes y textos generados por **Spark** desde **Google Drive** hacia **Facebook e Instagram** (Feed + Stories) según un horario programado.

Incluye un **Panel de Control Web** moderno con autenticación para monitorear el estado, ver los posts en cola, el historial de publicaciones y forzar publicaciones manuales.

---

## 🌟 Características

- **Publicación Multi-Plataforma:** Publica simultáneamente en **Facebook Feed**, **Facebook Stories**, **Instagram Feed** e **Instagram Stories**.
- **4 Franjas Horarias Diarias:** Configurado por defecto para publicar 4 posts y 4 stories al día (10:00, 14:00, 18:00 y 21:00 - Horario de Casablanca).
- **Lectura Inteligente de Drive:** Detecta archivos sueltos en "My Drive", emparejando la foto (`.jpg`/`.png`) con el texto del Google Doc (`Post X - ...`).
- **Prevención de Duplicados:** Al publicar, renombra los archivos en Google Drive con el prefijo `[PUBLICADO]`.
- **Panel Web Seguro:** Protegido con usuario y contraseña, endpoints de salud (`/health`) para Coolify/Docker.
- **Preparado para Coolify y Docker:** `Dockerfile` basado en `node:20-alpine` con soporte de zona horaria `tzdata`.

---

## 📁 Estructura en Google Drive

Los archivos van colocados en la raíz de Google Drive ("Mi unidad"):
```text
Mi unidad /
├── 📄 Post 1 - Renault Kardian - Aeroport Tanger        (Google Doc con el copy)
├── 🖼️ Post 1 - Renault Kardian - Aeroport Tanger.jpg    (Foto)
├── 📄 Post 2 - Seat Ibiza FR - Commerciale              (Google Doc con el copy)
└── 🖼️ Post 2 - Seat Ibiza FR - Commerciale.jpg          (Foto)
```

Al publicarse, el bot los renombra automáticamente a:
- `[PUBLICADO] Post 1 - Renault Kardian - Aeroport Tanger`
- `[PUBLICADO] Post 1 - Renault Kardian - Aeroport Tanger.jpg`

---

## 🚀 Despliegue en Coolify

1. **Crear recurso en Coolify:**
   - Selecciona **Public / Private Git Repository** y vincula este repositorio.
   - Coolify detectará el `Dockerfile` automáticamente.
2. **Puerto:**
   - Configura el puerto expuesto en `3050`.
3. **Variables de Entorno:**
   - Copia las variables desde `.env.example` y define tus credenciales:
     - `DASHBOARD_USER` y `DASHBOARD_PASS` para proteger el panel.
     - `FACEBOOK_PAGE_ID` y `FACEBOOK_PAGE_ACCESS_TOKEN` para la API de Meta.
     - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` para conectar Google Drive.
     - `PUBLIC_SERVER_URL` con tu dominio público de Coolify (ej: `https://publisher.tudominio.com`).
     - `GOOGLE_REDIRECT_URI` configurado a `https://publisher.tudominio.com/auth/callback`.
4. **Volumen Persistente (Storages):**
   - Agrega un volumen persistente mapeando el destino `/app/data` para preservar la sesión de Google (`tokens.json`) y el historial entre reinicios.

---

## 💻 Ejecución Local

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Configurar variables en `.env`.
3. Iniciar el servicio:
   ```bash
   npm start
   # O en Windows: doble clic en start.bat
   ```
4. Abrir en el navegador: `http://localhost:3050`
