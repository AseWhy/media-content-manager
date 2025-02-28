import { EventEmitter } from "events";
import { FSDB } from "file-system-db";
import { TorrentData, TorrentFileData } from "./torrentData";
import { join, parse } from "path";
import { hash } from "crypto";
import { CONFIG, ConfigCategoryName, DOWNLOAD_DIR, DOWNLOAD_LIMIT } from "@const";
import { saveFile } from "./torrentFileSaver";
import { Service } from "typedi";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { Monitor } from "@service/montor";
import { PersistentStore, PersistentStoreAdapter } from "@service/persistentStore";

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

    /** Карта, где ключ это хеш, а значение это данные торрента */
    private _processed: Record<string, TorrentData> = {};

    /**
     * Восстанавливает утраченные загрузки
     */
    public async restoreDownloading() {
        const data: Record<string, TorrentStoredData> = DATABASE.get(DOWNLOADS_KEY) ?? {};
        for (const [ hash, storedData ] of Object.entries(data)) {
            if (this._processed[hash]) {
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
        if (this._processed[torrentHash]) {
            return { result: "already_downloading", data: this._processed[torrentHash] };
        } else {
            const data = await this._addToDownload(torrentHash, torrentData);
            this._processed[torrentHash] = data;
            data.on("done", () => delete this._processed[torrentHash]);
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
            const torrentDirectory = join(DOWNLOAD_DIR, hash);

            if (!existsSync(torrentDirectory)) {
                await mkdir(torrentDirectory, { recursive: true });
            }

            const torrentData = new TorrentData(TORRENT_CLIENT.add(data.magnet, { path: torrentDirectory }), category, hash, data.data);
            const pathFunction = new Function(..._.keys(data.additionalData), "filename", "name", 'i', "ext", category.pathFunction);
            const store = new PersistentStoreAdapter(DATABASE, "_persistent." + hash);
            const montor = new Monitor(this._onDownload.bind(this, hash, torrentData, data, pathFunction), 1000, store);

            // Получение информации о торренте
            torrentData.on("metadata", () => {
                const files = torrentData.files;
                if (files.length === 0) {
                    torrentData.destroy();
                    rej(new TorrentError("Не найдено подходящих для загрузки файлов"));
                } else {
                    this._markTorrentAsDownloading(hash, data);
                    res(torrentData);
                }
            });
            
            // Действие при ошибке
            torrentData.on("error", rej);
            // Действие при завершении загрузки
            torrentData.on("done", montor.call.bind(montor));
            // Действие при загрузке данных
            torrentData.on("download", montor.call.bind(montor));

            console.log(`Добавлена загрузка ${hash}, ${data.category}, ${data.name}`, data.data);
        });
    }

    /**
     * Действие при прогресс загрузки торрента
     * @param hash         хеш
     * @param torrentData  данные торрента
     * @param data         данные для загрузки торрента
     * @param pathFunction функция получения пути сохраняемого файла
     * @param store        постоянное хранилище
     */
    private async _onDownload(hash: string, torrentData: TorrentData, data: TorrentStoredData, pathFunction: Function,
        store: PersistentStore) {
        
        // Если торрент ещё не готов к загрузке, или он уже завершен, то не обрабатываем событие загрузки
        if (!torrentData.ready || store.get("completed")) {
            return;
        }

        let files = _.sortBy(torrentData.files, "path");
        let allFilesLoad = true;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const processedKey = `processed_${i}`;
            
            if (file.progress === 100) {
                if (store.get(processedKey)) {
                    continue;
                }

                // Обрабатываем файл
                await this._onFileDone(file, data, pathFunction, i);

                // Помечаем файл как обработанный
                store.set(processedKey, true);
            } else {
                allFilesLoad = false;
            }
        }

        this.emit("download", torrentData, data);

        if (allFilesLoad) {
            await this._onDone(files, data, pathFunction, hash, torrentData);
            store.set("completed", true);
        }
    }

    /**
     * Действие при завершении загрузки файла
     * @param montorData   данные монитора
     * @param file         файл загрузка которого завершена
     * @param data         данные для загрузки торрента
     * @param pathFunction функция получения пути сохраняемого файла
     * @param i            индекс файла
     */
    private async _onFileDone(file: TorrentFileData, data: TorrentStoredData, pathFunction: Function, i: number) {
        if (CONFIG.fileSaveStrategy !== "byFile") {
            return;
        }

        const pathData = parse(file.path);
        const pathToFileWillSave = join(data.category, pathFunction(..._.values(data.additionalData),
            pathData.name, data.name, i, pathData.ext));

        await saveFile(data.category, file.path, pathToFileWillSave, data.data);
    }

    /**
     * Действие при полной загрузке торрента
     * @param files        набор файлов для загрузки
     * @param data         данные для загрузки торрента
     * @param pathFunction функция получения пути сохраняемого файла
     * @param hash         хеш
     * @param torrentData  данные торрента
     */
    private async _onDone(files: TorrentFileData[], data: TorrentStoredData, pathFunction: Function, hash: string, torrentData: TorrentData) {
        // Отправляем файлы на постобработку
        await this._onAllFilesDone(files, data, pathFunction);

        this.emit("done", torrentData);
        this._markTorrentAsDownloaded(hash);

        // Удаляем директорию торрента
        await rm(torrentData.path, { recursive: true });

        // Очищаем ресурсы
        torrentData.destroy();
    }

    /**
     * Действие при успешной загрузке всех файлов
     * @param files        загруженные файлы
     * @param data         данные торрента
     * @param pathFunction функция получения пути сохраняемого файла
     */
    private async _onAllFilesDone(files: TorrentFileData[], data: TorrentStoredData, pathFunction: Function) {
        if (CONFIG.fileSaveStrategy !== "byTorrent") {
            return;
        }

        await Promise.all(
            files.map(({ path }, i) => {
                const pathData = parse(path);
                const pathToFileWillSave = join(data.category, pathFunction(..._.values(data.additionalData),
                    pathData.name, data.name, i, pathData.ext));

                return saveFile(data.category, path, pathToFileWillSave, data.data);
            })
        );
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