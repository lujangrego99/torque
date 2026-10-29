FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Primero solo los manifiestos: si no cambian, Docker reutiliza la capa de npm ci.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Puerto interno por defecto (se puede cambiar con PORT).
ENV PORT=3000
EXPOSE 3000

# El proceso no corre como root.
USER node

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
