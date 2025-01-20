FROM node:20.18.1

# Создаем рабочий каталог
RUN mkdir -p /opt/common;\
    mkdir -p /opt/common/app

# Устанавливаем рабочий каталог
WORKDIR /opt/common

COPY ./package.json .
COPY ./tsconfig.json .

# Собираем
RUN npm install;

# Устанавливаем рабочий каталог
WORKDIR /opt/common/app

# Копируем файлы
COPY ./media-telegram-manager-bot/package.json .
COPY ./media-telegram-manager-bot/tsconfig.json .

# Копируем директории
COPY ./media-telegram-manager-bot/src/ ./src
COPY ./media-telegram-manager-bot/config/ ./config

# Собираем
RUN npm install; \
    npm run build; \
    rm -r ./src

# Запуск
CMD [ "node", "--import=extensionless/register", "./dist" ]
