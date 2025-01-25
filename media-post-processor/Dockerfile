FROM node:20.18.1

# Устанавливаем кодировку
ENV LANGUAGE UTF-8
ENV LANG UTF-8
ENV LC_ALL UTF-8

# Создаем рабочий каталог
RUN mkdir -p /opt/common; \
    mkdir -p /opt/common/app; \
    echo "deb http://deb.debian.org/debian bookworm main contrib non-free\ndeb-src http://deb.debian.org/debian bookworm main contrib non-free" >> /etc/apt/sources.list; \
    apt update; \
    apt install -y vainfo intel-media-va-driver-non-free libva-dev libva-drm2 libva-x11-2 libdrm-dev ffmpeg; \
    rm -rf /var/lib/apt/lists/* 

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
