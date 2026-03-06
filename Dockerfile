FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY index.js config.js outlook-auth-server.js ./
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
