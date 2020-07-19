FROM node:12.18.2-alpine
COPY package*.json ./
COPY *.js ./
RUN npm ci
EXPOSE 8080
CMD [ "npm", "start" ]