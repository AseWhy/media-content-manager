FROM node:20.18.1

# Устанавливаем кодировку
ENV LANGUAGE ru_RU.UTF-8
ENV LANG ru_RU.UTF-8
ENV LC_ALL ru_RU.UTF-8

# Создаем рабочий каталог
RUN mkdir -p /opt/common; \
    mkdir -p /opt/common/app; \
    apt update; \
    apt install -y software-properties-common; \
    add-apt-repository 'deb http://archive.ubuntu.com/ubuntu natty main restricted universe multiverse non-free'; \
    add-apt-repository 'deb http://ftp.uk.debian.org/debian bookworm-updates main contrib non-free'; \
    add-apt-repository 'deb http://ftp.uk.debian.org/debian bookworm main contrib non-free'; \
    add-apt-repository 'deb http://security.debian.org bookworm-security main contrib non-free'; \
    apt update; \
    apt install -y autoconf automake bison flex autopoint libtool \
    libglib2.0-dev yasm nasm xutils-dev libpthread-stubs0-dev libpciaccess-dev libudev-dev \
    libxrandr-dev libegl1-mesa-dev openssh-server git-core wget \
    build-essential gettext libgles2-mesa-dev libshout3-dev libsoup2.4-dev \
    nginx libssl-dev intel-gpu-tools libopencv-dev opencv-data software-properties-common software-properties-common \
    intel-media-va-driver-non-free ffmpeg

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
