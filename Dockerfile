# Usar imagen base ligera y moderna de Node.js
FROM node:20-alpine

# Instalar tzdata para garantizar soporte de zona horaria oficial (Casablanca/Madrid)
RUN apk add --no-cache tzdata

WORKDIR /app

# Instalar dependencias primero para aprovechar cache de capas Docker
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copiar el código fuente
COPY . .

# Garantizar directorios necesarios
RUN mkdir -p data temp credentials

# Puerto de la aplicación (Coolify asignará el proxy a este puerto)
EXPOSE 3050

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3050

# Verificación de salud periódica para Coolify/Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3050/health || exit 1

# Comando de arranque
CMD ["npm", "start"]
