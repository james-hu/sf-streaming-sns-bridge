FROM node:12.19.0-alpine
COPY package*.json ./
COPY *.js ./
RUN npm ci
EXPOSE 8080
CMD [ "npm", "start" ]