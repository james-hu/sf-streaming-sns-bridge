FROM node:10.17.0-alpine
COPY package*.json ./
COPY *.js ./
RUN npm ci
CMD [ "npm", "start" ]