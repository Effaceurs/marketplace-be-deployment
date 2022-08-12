FROM node:16.14.2-slim

ENV NODE_EVN production

USER node

WORKDIR /home/node/

COPY --chown=node:node . /home/node/

RUN npm ci --only=production

CMD ["node", "consumer.js"]
