# Менеджер медиатеки

В этом репозитории содержится код менеджера медиатеки, который совместим с медиа сервером типа jellyfin или plex.<br>

Менеджер позволяет загружать, удалять, перемещать файлы в медиатеке по средствам telegram бота. Загруженные медиа данные также могут подвергать постобработке (в зависимости от конфигурации).

# Сборка
Сборку можно выполнять по средствам docker или вручную

## Вручную
Для сборки вручную необходимо выполнить в корневой директории и в директории каждого модуля

    # Установка общих зависимостей в корневой директории
    yarn install
    
    # Установка зависимостей пост обработчика
    cd media-post-processor
    yarn install
    
    # Поднимаемся выше
    cd ../

    # Установка зависимостей бота
    cd media-telegram-manager-bot
    yarn install

## Docker
Для сборки docker нужно выполнить команды в корневой директории проекта

    # Сборка пост обработчика
    docker build . -t 'media-post-processor:latest' -f ./media-post-processor/Dockerfile
    
    # Сборка бота
    docker build . -t 'media-telegram-manager-bot:latest' -f ./media-telegram-manager-bot/Dockerfile


# Запуск
В зависимости от того как выполнялась сборка, для запуска доступно несколько вариантов. Первым необходимо запускать пост обработчик, чтобы он мог создать сервер. Бот должен запускаться вторым.

## На хосте
Для запуска на хосте, нужно использовать команды ниже. Для запуска пост обработчика на хосте должен быть установлен ffmpeg.

    
    # Запуск пост обработчика
    cd media-post-processor
    yarn start
    
    # Поднимаемся выше
    cd ../

    # Запуск бота
    cd media-telegram-manager-bot
    yarn start

## Docker
Для запуска ранее собранных образов нужно выполнить команды
    
    # Запуск пост обработчика
    docker run -p 1949:1949 'media-post-processor:latest'

    # Запуск бота
    docker 'media-telegram-manager-bot:latest'

### Проблемы
При запуске в среде docker могут возникнуть некоторые проблемы.

1. **Низкая скорость передачи медиа на пост обработчик**</br>

   **Описание:**</br>
   Если используется docker root-less, то можно столкнуться с ограничением скорости передачи медиафайлов между пост обработчиком и ботом (например вместо 1 G/S может быть где-то 100-150M/S) особенно это заметно в локальных сетях.
   
   **Решение:**</br>
   В качестве решения можно использовать nerdctl вместо docker в связке с *bypass4netns*. [Подробнее](https://docs.docker.com/engine/security/rootless/#networking-errors)

### Docker Compose - примеры конфигурации
Для быстрого запуска в docker-compose можно использовать следующие конфигурации

    # Конфигурация бота
    media-telegram-manager-bot.service:
        image: media-telegram-manager-bot:latest
        restart: always
        volumes:
            - ./media:/media:rw
            - ./config/mpp:/opt/common/app/config
            - ./mpp/data:/opt/common/app/data
            - ./mpp/torrents:/torrents
        environment:
            - BOT_ALLOWED_USER_IDS=<ADMIN_USER_IDS>
            - BOT_TOKEN=<TOKEN>
            - DOWNLOAD_DIR=/torrents
            - MANAGED_DIR=/media
            - DOWNLOAD_LIMIT=42949672960

    # Конфигурация пост обработчика
    media-post-processor.latest.service:
        image: media-post-processor:latest
        restart: always
        volumes:
            - ./config/mpp:/opt/common/app/config
            - ./mpp/data:/opt/common/app/data
            - ./mpp/penging:/opt/common/app/penging
            - ./mpp/processing:/opt/common/app/processing
        ports:
            - 1949:1949
        devices:
            # Тут можно передать устройства для hwa
            - /dev/dri/renderD128:/dev/dri/renderD128
        environment:
            - PENDING_DIR=/opt/common/app/penging
            - PROCESSING_DIR=/opt/common/app/processing

# TODO
- Добавить опцию создания новой панели при создании новой загрузки
- Добавить прогресс пост обработки медиафайлов

# Важно
- Проблема: Иногда устройство hw требует прав суперпользователя</br>
  Решение: `sudo chmod 666 /dev/dri/renderD128`, где renderD128 - это устройство hw

# Решено
- Работа пост обработчика проверена на Intel N97, возможно на других процессорах потребуются дополнительные изменения кода или настройки. В таким случае предлагаю внести PR который бы добавлял конкретную функциональность