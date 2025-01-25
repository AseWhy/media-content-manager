import { EventEmitter } from "events";
import { FSDB } from "file-system-db";
import { TorrentData } from "./torrentData";
import { join, parse } from "path";
import { hash } from "crypto";
import { CONFIG, ConfigCategoryName, DOWNLOAD_DIR, DOWNLOAD_LIMIT } from "../../constants";
import { saveFile } from "./torrentFileSaver";
import { Service } from "typedi";
import { rm } from "fs/promises";

import WebTorrent from "webtorrent";
import _ from "lodash";

/** Torrent клиент */
const TORRENT_CLIENT = new WebTorrent({ downloadLimit: DOWNLOAD_LIMIT });

/** Хранилище в файловой системе */
const DATABASE = new FSDB("./data/torrent.json", false);

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
        const data: Record<string, TorrentStoredData> = DATABASE.get(DOWNLOADS_KEY) ?? {};
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
        return new Promise(async (res, rej) => {
            const category = CONFIG.categories[data.category];
            const torrentData = new TorrentData(TORRENT_CLIENT.add(data.magnet, { path: join(DOWNLOAD_DIR, hash) }), category, hash, data.data);
            const pathFunction = new Function(..._.keys(data.additionalData), "filename", "name", 'i', "ext", category.pathFunction);

            // Пиры не найдены
            torrentData.on("noPeers", () => {
                // Уведомляем что пиры не найдены
                return res(torrentData);
            });

            // Получение информации о торренте
            torrentData.on("metadata", () => {
                if (torrentData.files.length === 0) {
                    torrentData.destroy();
                    rej(new TorrentError("Не найдено подходящих для загрузки файлов. "));
                } else {
                    this._markTorrentAsDownloading(hash, data);
                    res(torrentData);
                }
            });
            
            // Действие при ошибке
            torrentData.on("error", rej);

            // Действие при загрузке данных
            torrentData.on("download", () => {
                if (torrentData.ready) {
                    this.emit("download", torrentData, data);
                }
            });

            // Действие при завершении загрузки
            torrentData.on("done", async () => {
                await Promise.all(
                    _
                        .chain(torrentData.files)
                        .sortBy("path")
                        .map(({ path }, i) => {
                            const { name, ext } = parse(path);
                            return saveFile(data.category, path,
                                join(data.category, pathFunction(..._.values(data.additionalData), name, data.name, i, ext)),
                                    data.data);
                        })
                    .value()
                );

                this.emit("done", torrentData, data);
                this._markTorrentAsDownloaded(hash);

                await rm(torrentData.path, { recursive: true });
    
                torrentData.destroy();
            });

            console.log(`Добавлена загрузка ${hash}, ${data.category}, ${data.name}`, data.data);
        });
    }

    /**
     * Помечает торрент как загруженный
     * @param hash хеш
     */
    private _markTorrentAsDownloaded(hash: string): void {
        if (this._isDownloading(hash)) {
            DATABASE.delete(`${DOWNLOADS_KEY}.${hash}`);
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
        DATABASE.set(`${DOWNLOADS_KEY}.${hash}`, torrentData);
    }

    /**
     * 
     * @param hash 
     * @returns 
     */
    private _isDownloading(hash: string): boolean {
        const data: Record<string, TorrentStoredData> = DATABASE.get(DOWNLOADS_KEY) ?? {};
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
    /** Дополнительные данные */
    additionalData: Record<string, string>;
    /** Магнитная ссылка */
    magnet: string;
    /** Дополнительные данные */
    data: Record<string, string>;
};