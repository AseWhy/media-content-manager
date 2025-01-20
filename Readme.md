# Менеджер медиатеки

В этом репозитории содержится код менеджера медиатеки, который совместим с медиасервером типа jellyfin или plex.<br>

Менеджер позволяет загружать, удалять, перемещать файлы в медиатеке по средствам telegram бота. Загруженные медиаданные так-же могут подвергать пост-обработке (в зависимости от конфигурации).

# Сборка образа пост обработчика

    docker build . -t 'media-post-processor:latest' -f ./media-post-processor/Dockerfile

# Сборка образа бота

    docker build . -t 'media-telegram-manager-bot:latest' -f ./media-telegram-manager-bot/Dockerfile