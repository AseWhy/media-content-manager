import { Wire } from "bittorrent-protocol";
import { extname, join } from "path";
import { Torrent } from "webtorrent";
import { ConfigCategory } from "../../constants";

/** Дополнительные данные торрента */
export type TorrentAdditionalData = Record<string, string | number>;

/**
 * Данные торрента
 */
export class TorrentData {

    /**
     * Конструктор
     * @param _torrent торрент
     * @param id       идентификатор загрузки
     * @param data     дополнительные данные
     */
    constructor(private readonly _torrent: Torrent, public readonly id: string, public readonly data: TorrentAdditionalData) {
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
        return this._torrent.progress * 100;
    }

    /**
     * Возвращает размер загруженных файлов в байтах
     */
    public get downloaded() {
        return this._torrent.downloaded;
    }

    /**
     * Возвращает размер загружаемых файлов в байтах
     */
    public get size() {
        return this._torrent.length;
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
        return this._torrent.files;
    }

    /**
     * Возвращает список файлов торрента
     */
    public getFiles(category: ConfigCategory): TorrentFileData[] {
        const result: TorrentFileData[] = [];
        for (const file of this._torrent.files) {
            const ext = extname(file.name);
            if (!category.ext.includes(ext)) {
                continue;
            }
            result.push(new TorrentFileData(join(this._torrent.path, file.path), file.name, file.progress * 100, file.downloaded, file.length));
        }
        return result;
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