FROM node:22-alpine

LABEL org.opencontainers.image.title="Outlook Assistant"
LABEL org.opencontainers.image.description="MCP server for Microsoft Outlook — 21 tools for email, calendar, contacts, and settings via Graph API"
LABEL org.opencontainers.image.source="https://github.com/littlebearapps/outlook-assistant"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY index.js config.js outlook-auth-server.js llms.txt ./
COPY auth/ auth/
COPY calendar/ calendar/
COPY categories/ categories/
COPY contacts/ contacts/
COPY email/ email/
COPY folder/ folder/
COPY rules/ rules/
COPY settings/ settings/
COPY advanced/ advanced/
COPY utils/ utils/

ENTRYPOINT ["node", "index.js"]
