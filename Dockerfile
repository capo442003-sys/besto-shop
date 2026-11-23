# ——— Étape 1 : compilation de l'interface (Vite) ———
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev
COPY frontend/ ./
RUN npm run build

# ——— Étape 2 : API + interface compilée ———
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend --omit=dev

COPY database ./database
COPY backend ./backend
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV SERVE_CLIENT=1

EXPOSE 3001

CMD ["npm", "run", "start:cloud", "--prefix", "backend"]
