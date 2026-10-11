# 🚗 2S1M Auto-Publisher (3 Posts de Feed + 4 Stories Exclusivas)

Sistema autónomo para publicar automáticamente imágenes y textos generados por **Spark** desde **Google Drive** hacia **Facebook e Instagram** según un horario optimizado para Marruecos.

Incluye un **Panel de Control Web** con autenticación, consola de logs en vivo y gestión separada de Feed y Stories.

---

## 🌟 Estructura Diaria (7 Publicaciones al Día)

Spark entrega los archivos diarios a las **08:30 AM** directamente en Google Drive ("Mi unidad"):

### 1. Los 3 Posts para el Feed (Formato Cuadrado 1:1 con Texto)
- **Post 1 (Mañana - VIP & Aeropuertos):** `Post 1 - [Modelo] - [Tema].jpg` + Google Doc `Post 1 - [Modelo] - [Tema]`
- **Post 2 (Mediodía - Afiche Comercial):** `Post 2 - [Modelo] - [Tema].jpg` + Google Doc `Post 2 - [Modelo] - [Tema]` (Tarifas desde 250 DH/día)
- **Post 3 (Tarde/Noche - Lifestyle / Noche 24/7):** `Post 3 - [Modelo] - [Tema].jpg` + Google Doc `Post 3 - [Modelo] - [Tema]`

### 2. Las 4 Fotos Exclusivas para Stories (Formato Vertical 9:16)
Imágenes a pantalla completa (1080 × 1920 px) diseñadas para evitar recortes:
- **Story 1 (Aeronáutica / Llegadas):** `Stories 2s1m - 1 - [Tema].jpg`
- **Story 2 (Tarifas desde 250 DH):** `Stories 2s1m - 2 - [Tema].jpg`
- **Story 3 (Escapadas / Ruta norte):** `Stories 2s1m - 3 - [Tema].jpg`
- **Story 4 (Llamada a la Acción WhatsApp):** `Stories 2s1m - 4 - [Tema].jpg`

---

## ⏰ Las 7 Franjas Diarias Oficiales (Hora de Casablanca / GMT+1)

| Franja | Hora | Tipo | Contenido | Destinos |
| :---: | :---: | :---: | :--- | :--- |
| **1** | **10:00** | ⚡ Story | Story 1 (Aeronáutica / Llegadas aeropuertos) | FB & IG Stories |
| **2** | **11:30** | 🖼️ Post | Post 1 (VIP & Aeropuertos TNG / TTU) | FB & IG Feed |
| **3** | **13:30** | ⚡ Story | Story 2 (Oferta del Día: desde 250 DH) | FB & IG Stories |
| **4** | **15:30** | 🖼️ Post | Post 2 (Afiche Comercial con tarifas y WhatsApp) | FB & IG Feed |
| **5** | **18:00** | ⚡ Story | Story 3 (Destino / Escapadas turísticas norte) | FB & IG Stories |
| **6** | **20:00** | 🖼️ Post | Post 3 (Lifestyle, Road Trip o Noche 24/7) | FB & IG Feed |
| **7** | **21:30** | ⚡ Story | Story 4 (Llamada a la acción / Reserva WhatsApp) | FB & IG Stories |

---

## 🏷️ Renombrado en Google Drive

Al publicarse cada post o story, el bot renombra automáticamente los archivos añadiéndoles el prefijo **`[PUBLICADO]`**:
- `[PUBLICADO] Post 1 - Renault Kardian - Aeroport.jpg`
- `[PUBLICADO] Post 1 - Renault Kardian - Aeroport`
- `[PUBLICADO] Stories 2s1m - 1 - Aeroport.jpg`

---

## 🚀 Despliegue en Coolify

1. **Vincular Repositorio:** `https://github.com/Ahmedelfakirben/Drive-Meta-Publisher`
2. **Puerto Expuesto:** `3050`
3. **Volumen Persistente:** `/app/data`
4. **Variables de Entorno Requeridas:**
   - `DASHBOARD_USER` y `DASHBOARD_PASS`
   - `FACEBOOK_PAGE_ID` y `FACEBOOK_PAGE_ACCESS_TOKEN`
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`
   - `PUBLIC_SERVER_URL`
   - `TIMEZONE=Africa/Casablanca`
