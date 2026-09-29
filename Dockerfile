FROM node:22-alpine
WORKDIR /app
COPY . .
EXPOSE 7860
ENV PORT=7860
CMD ["node", "server.mjs"]
