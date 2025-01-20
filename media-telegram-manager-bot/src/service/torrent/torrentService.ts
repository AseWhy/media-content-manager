import { EventEmitter } from "events";
import { FSDB } from "file-system-db";
import { TorrentAdditionalData, TorrentData } from "./torrentData";
import { join } from "path";
import { hash } from "crypto";
import { CONFIG, ConfigCategoryName, DOWNLOAD_LIMIT, MANAGED_DIR } from "../../constants";
import { saveFile } from "./torrentFileSaver";
import { Service } from "typedi";

import WebTorrent from "webtorrent";
import _ from "lodash";

/** Torrent клиент */
const TORRENT_CLIENT = new WebTorrent({ downloadLimit: DOWNLOAD_LIMIT });

/** Хранилище в файловой системе */
const FILE_SYSTEM_DB = new FSDB("./data/torrent.json", false);

/** Ключ загружаемых торрент файлов */
const DOWNLOADS_KEY = "downloads";

/**
 * Менеджер торрентов
 */
@Service()
export class TorrentService extends EventEmitter {

    /** Карта, где ключ это хеш магнитный ссылки, а значение это данные торрента */
    private processed: Record<string, TorrentData> = {};

    /**
     * Восстанавливает утраченные загрузки
     */
    public async restoreDownloading() {
        const data: Record<string, TorrentStoredData> = FILE_SYSTEM_DB.get(DOWNLOADS_KEY) ?? {};
        for (const [ hash, storedData ] of Object.entries(data)) {
            if (this.processed[hash]) {
                continue;
            }
            try {
                await this._addToDownload(hash, storedData);
            } catch(e) {
                console.error("Ошибка добавления торрента на скачивание", e.message);
            }
        }
    }

    /**
     * Добавляет загрузку торрента
     * @param data данные для загрузки торрента
     */
    public async download(torrentData: TorrentStoredData): Promise<DownloadResult> {
        const torrentHash = hash("sha256", torrentData.magnet);
        if (this.processed[torrentHash]) {
            return { result: "already_downloading", data: this.processed[torrentHash] };
        } else {
            const data = await this._addToDownload(torrentHash, torrentData);
            this.processed[torrentHash] = data;
            data.on("done", () => delete this.processed[torrentHash]);
            return { result: "success", data };
        }
    }

    /**
     * Добавляет загрузку торрента
     * @param hash хеш
     * @param data данные для загрузки торрента
     * @returns данные загружаемого торрента
     */
    private _addToDownload(hash: string, data: TorrentStoredData): Promise<TorrentData> {
        return new Promise((res, rej) => {
            const torrentData = new TorrentData(TORRENT_CLIENT.add(data.magnet), hash, data.data);

            // Пиры не найдены
            torrentData.on("noPeers", () => {
                // Уведомляем что пиры не найдены
                res(torrentData);
            });

            // Получение информации о торренте
            torrentData.on("metadata", () => {
                if (torrentData.getFiles(CONFIG.categories[data.category]).length === 0) {
                    torrentData.destroy();
                    rej(new TorrentError("Не найдено подходящих для загрузки файлов. "));
                } else {
                    res(torrentData);
                }
            });

            // Действие при загрузке данных
            torrentData.on("download", () => {
                if (torrentData.ready) {
                    this.emit("download", torrentData, data);
                }
            });
            
            // Действие при завершении загрузки
            torrentData.on("done", async () => {
                await Promise.all(torrentData.getFiles(CONFIG.categories[data.category])
                    .map(({ path }) => {
                        let destinationDir = join(MANAGED_DIR, data.category, data.name);
                        if (data.dir) {
                            destinationDir = join(destinationDir, data.dir);
                        }
                        return saveFile(data.category, path, destinationDir);  
                    }));

                this.emit("done", torrentData, data);
                this._markTorrentAsDownloaded(hash);
    
                torrentData.destroy();
            });

            console.log(`Добавлена загрузка ${hash}, ${data.category}, ${data.name}`, data.data);

            this._markTorrentAsDownloading(hash, data);
        });
    }

    /**
     * Помечает торрент как загруженный
     * @param hash хеш
     */
    private _markTorrentAsDownloaded(hash: string): void {
        if (this._isDownloading(hash)) {
            const data: Record<string, TorrentStoredData> = FILE_SYSTEM_DB.get(DOWNLOADS_KEY) ?? {};
            delete data[hash];
            FILE_SYSTEM_DB.set(DOWNLOADS_KEY, data);
        }
    }

    /**
     * Помечает торрент как загружаемый
     * @param hash        хеш
     * @param torrentData сохраняемые данные торрента
     * @param torrent     торрент
     */
    private _markTorrentAsDownloading(hash: string, torrentData: TorrentStoredData): void {
        if (this._isDownloading(hash)) {
            return;
        }
        const data: Record<string, TorrentStoredData> = FILE_SYSTEM_DB.get(DOWNLOADS_KEY) ?? {};
        data[hash] = torrentData;
        FILE_SYSTEM_DB.set(DOWNLOADS_KEY, data);
    }

    /**
     * 
     * @param hash 
     * @returns 
     */
    private _isDownloading(hash: string): boolean {
        const data: Record<string, TorrentStoredData> = FILE_SYSTEM_DB.get(DOWNLOADS_KEY) ?? {};
        return data[hash] != null;
    }
}

/**
 * Ошибка загрузки торрента
 */
export class TorrentError extends Error {

}

/** Результат добавления загрузки */
export type DownloadResult = {
    /** Результат добавления загрузки */
    result: "success" | "already_downloading";
    /** Данные торрента */
    data: TorrentData;
}

/** Данные торрента */
export type TorrentStoredData = {
    /** Наименование папки назначения */
    name: string;
    /** Категория загрузки */
    category: ConfigCategoryName;
    /** Поддиректория, в которую необхоидмо переместить файлы */
    dir: string | null;
    /** Магнитная ссылка */
    magnet: string;
    /** Дополнительные данные */
    data: TorrentAdditionalData;
};