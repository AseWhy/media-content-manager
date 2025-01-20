FROM node:20.18.1

# Создаем рабочий каталог
RUN mkdir -p /opt/common; \
    mkdir -p /opt/common/app; \
    sudo add-apt-repository ppa:mc3man/trusty-media; \
    apt update; \
    apt install -y ffmpeg

# Устанавливаем рабочий каталог
WORKDIR /opt/common

COPY ./package.json .
COPY ./tsconfig.json .

# Собираем
RUN npm install;

# Устанавливаем рабочий каталог
WORKDIR /opt/common/app

# Копируем файлы
COPY ./media-post-processor/package.json .
COPY ./media-post-processor/tsconfig.json .

# Копируем директории
COPY ./media-post-processor/src/ ./src
COPY ./media-post-processor/config/ ./config

# Собираем
RUN npm install; \
    npm run build; \
    rm -r ./src

# Запуск
CMD [ "node", "--import=extensionless/register", "./dist" ]
