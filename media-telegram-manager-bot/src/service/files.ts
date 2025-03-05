import { FilesListMode } from "@const";
import { FSDB } from "file-system-db";
import { ChatId } from "node-telegram-bot-api";
import { FileData } from "./storageManager";
import { resolveDataDir } from "@service";

/** Ключ данных чата списка файлов */
export const FILES_LIST_CHAT_DATA = "filesList";

/** Ключ режима чата списка файлов */
export const FILES_LIST_MODE_CHAT_DATA = "filesList:mode";

/** Ключ страницы чата списка файлов */
export const FILES_LIST_PAGE_CHAT_DATA = "filesList:page";

/** Режимы отображения файлов по умолчанию */
const DEFAULT_FILES_LIST_MODE: FilesListMode[] = [ "directories", "files" ];

/**
 * Представление файлов чата
 */
export class Files {

    /** База данных */
    private readonly _db: FSDB;

    /** Кеш файлов */
    private _filesCache: null | FileData[] = null;

    /** Кеш режимов работы */
    private _modesCache: null |  FilesListMode[] = null;

    /** Кеш страницы */
    private _pageCache: null |  number = null;

    /**
     * Конструктор
     * @param chatId идентификатор чата
     */
    constructor(chatId: ChatId) {
        this._db = new FSDB(resolveDataDir("./files/" + chatId + ".json"));
    }

    /**
     * Возвращает текущую страницу списка файлов
     */
    get page() {
        if (!this._pageCache) {
            this._pageCache = this._db.get(FILES_LIST_PAGE_CHAT_DATA) ?? 0;
        }
        return this._pageCache!;
    }

    /**
     * Возвращает текущую страницу списка файлов
     */
    set page(value: number) {
        this._db.set(FILES_LIST_PAGE_CHAT_DATA, value);
    }

    /**
     * Режимы отображения файлов
     */
    get modes(): FilesListMode[] {
        if (!this._modesCache) {
            this._modesCache = this._db.get(FILES_LIST_MODE_CHAT_DATA) ?? DEFAULT_FILES_LIST_MODE;
        }
        return this._modesCache!;
    }

    /**
     * Устанавливает режиы отображения файлов
     */
    set modes(values: FilesListMode[]) {
        this._db.set(FILES_LIST_MODE_CHAT_DATA, values);
    }

    /**
     * Возвращает полный список файлов
     */
    get files(): FileData[] {
        if (!this._filesCache) {
            const modes = new Set(this.modes);
            const files: FileData[] = this._db.get(FILES_LIST_CHAT_DATA) ?? []
            this._filesCache = files.filter(file => modes.has(file.isFile ? "files" : "directories"));
        }
        return this._filesCache!;
    }

    /**
     * Устанавливает полный список файлов
     */
    set files(values: FileData[]) {
        this._db.set(FILES_LIST_CHAT_DATA, values);
    }
}