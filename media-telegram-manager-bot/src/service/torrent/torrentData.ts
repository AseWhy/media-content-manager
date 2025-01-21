import { Wire } from "bittorrent-protocol";
import { extname, join } from "path";
import { Torrent } from "webtorrent";
import { ConfigCategory } from "../../constants";

import _ from "lodash";

/** Дополнительные данные торрента */
export type TorrentAdditionalData = Record<string, string | number>;

/**
 * Данные торрента
 */
export class TorrentData {

    /** Прогресс загрузки от 0 до 100 */
    private _progress: number = 0;

    /** Количество загруженных байт */
    private _downloaded: number = 0;

    /** Размер торрента в байтах */
    private _size: number = 0;

    /** Файлы торрента, подходящие под категорию */
    private _files: TorrentFileData[] = [];

    /**
     * Конструктор
     * @param _torrent  торрент
     * @param _category категория
     * @param id        идентификатор загрузки
     * @param data      дополнительные данные
     */
    constructor(private readonly _torrent: Torrent, private readonly _category: ConfigCategory, public readonly id: string,
        public readonly data: TorrentAdditionalData) {
        this.on("metadata", this._onMetadata.bind(this));
        this.on("download", this._onProgress.bind(this));
    }

    /**
     * Возвращает признак готовности к загрузке
     */
    public get ready() {
        return this._torrent.ready;
    }

    /**
     * Возвращает наименование торрента
     */
    public get name() {
        return this._torrent.name;
    }

    /**
     * Возвращает скорость загрузки торрента
     */
    public get downloadSpeed() {
        return this._torrent.downloadSpeed;
    }

    /**
     * Возвращает прогресс загрузки торрента
     */
    public get progress() {
        return this._progress;
    }

    /**
     * Возвращает размер загруженных файлов в байтах
     */
    public get downloaded() {
        return this._downloaded;
    }

    /**
     * Возвращает размер загружаемых файлов в байтах
     */
    public get size() {
        return this._size;
    }

    /**
     * Возвращает магнитную ссылку на торрент
     */
    public get magnet() {
        return this._torrent.magnetURI;
    }

    /**
     * Возвращает файлы торрента
     */
    public get files() {
        return this._files;
    }

    /**
     * Завершает работу с торрентом
     */
    public destroy(): void {
        this._torrent.destroy();
    }
    
    /**
     * Добавляет слушатель на событие метаданных, получения хеша информации, готовности и завершенности загрузки
     * @param event    событие
     * @param callback слушатель
     */
    public on(event: "infoHash" | "metadata" | "ready" | "done", callback: () => void): this;

    /**
     * Добавляет слушатель на событие получения предупреждения и ошибки
     * @param event    событие
     * @param callback слушатель
     */
    public on(event: "warning" | "error", callback: (err: Error | string) => void): this;

    /**
     * Добавляет слушатель на событие загрузки и выгрузки торрента
     * @param event    событие
     * @param callback слушатель
     */
    public on(event: "download" | "upload", callback: (bytes: number) => void): this;

    /**
     * Добавляет слушатель на событие подключение нового пира
     * @param event    событие
     * @param callback слушатель
     */
    public on(event: "wire", callback: (wire: Wire, addr?: string) => void): this;

    /**
     * Добавляет слушатель на событие отсутствия пиров
     * @param event    событие
     * @param callback слушатель
     */
    public on(event: "noPeers", callback: (announceType: "tracker" | "dht") => void): this;

    /**
     * Добавляет слушатель на событие
     * @param event    событие
     * @param callback слушатель
     */
    public on(event: any, callback: any): this {
        this._torrent.on(event, callback);
        return this;
    }

    /**
     * Действие при получении метаданных загрузки
     */
    private _onMetadata(): void {
        let progress = 0;

        for (const file of this._torrent.files) {
            const ext = extname(file.name);

            if (this._category.ext.includes(ext)) {
                const fileData = new TorrentFileData(join(this._torrent.path, file.path), file.name, file.progress * 100,
                    file.downloaded, file.length);

                progress += fileData.progress;
    
                this._downloaded += fileData.downloaded;
                this._size += fileData.size;
    
                this._files.push(fileData);
            } else {
                // Исключаем файл из загрузок
                file.deselect();
            }
        }

        this._progress = progress / this._files.length;
    }

    /**
     * Действие при обновлении прогресса загрузки
     */
    private _onProgress(): void {
        this._files.splice(0, this._files.length);

        this._downloaded = 0;
        this._size = 0;

        let progress = 0;

        for (const file of this._torrent.files) {
            const ext = extname(file.name);

            if (this._category.ext.includes(ext)) {
                const fileData = new TorrentFileData(join(this._torrent.path, file.path), file.name, file.progress * 100,
                    file.downloaded, file.length);

                progress += fileData.progress;
    
                this._downloaded += fileData.downloaded;
                this._size += fileData.size;
    
                this._files.push(fileData);
            }
        }

        this._progress = progress / this._files.length;
    }
}

/**
 * Данные загруженного торрент файла
 */
export class TorrentFileData {

    /**
     * Конструктор
     * @param path       путь до загруженного файла
     * @param name       наименование файла загруженного файла
     * @param progress   прогресс загрузки
     * @param downloaded размер загруженных данных
     * @param size       размер загружаемых данных
     */
    constructor(public readonly path: string, public readonly name: string, public readonly progress: number,
        public readonly downloaded: number, public readonly size: number) {

    }
}