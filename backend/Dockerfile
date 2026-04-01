FROM node:20-alpine

WORKDIR /app

# Instalar dependências
COPY package.json .
RUN npm install --omit=dev

# Copiar código
COPY src/ ./src/

# Arquivo de sessão Telegram (volume externo em produção)
VOLUME ["/app/logs", "/app/telegram_session.txt"]

# Não rodar como root
RUN addgroup -S botuser && adduser -S botuser -G botuser
USER botuser

CMD ["node", "src/index.js"]
