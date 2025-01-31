import { join, parse } from "path";
import { MANAGED_DIR } from "@const";
import { Stats } from "fs";
import { readdir, rename, rm, stat } from "fs/promises";
import { Service } from "typedi";

import _ from "lodash";

/**
 * Менеджер управляемого хранилища
 */
@Service()
export class StorageManager {

    /**
     * Перемещает файл внутри хранилища
     * @param src  оригинальное местоположение
     * @param dest местоположение назначения
     */
    public async move(src: string, dest: string): Promise<void> {
        return rename(join(MANAGED_DIR, this._normalize(src)), join(MANAGED_DIR, this._normalize(dest)));
    }

    /**
     * Переименовывает файл внутри хранилища
     * @param src     оригинальное местоположение
     * @param newName новое имя файла
     */
    public rename(src: string, newName: string): Promise<void> {
        const normalizedSrc = this._normalize(src);
        const { dir, ext } = parse(normalizedSrc);
        return rename(join(MANAGED_DIR, normalizedSrc), join(join(MANAGED_DIR, dir), newName + ext));
    }

    /**
     * Выполняет удаление директории и файлов внутри хранилища
     * @param src метоположение файла для удаления
     */
    public delete(src: string): Promise<void> {
        return rm(join(MANAGED_DIR, this._normalize(src)), { recursive: true, force: true });
    }

    /**
     * Возвращает массив файлов и каталогов в директории внутри хранилища
     * @param [filter=() => true] фильтр для выборки файлов
     * @param src                 местоположение директории у которой нужно получить массив файлов и каталогов
     * @returns массив файлов и каталогов в директории
     */
    public async filesList(filter: (stats: Stats, path: string) => boolean = () => true, src: string = ""): Promise<FileData[]> {
        const root = join(MANAGED_DIR, this._normalize(src));
        const paths = _.sortBy(await readdir(root, { recursive: true }));
        const stats = await Promise.all(paths.map(path => stat(join(root, path)).then(stat => ({ stat, path }))));
        return stats.filter(({ stat, path }) => filter(stat, path)).map(({ stat, path }) => ({ size: stat.size, isFile: stat.isFile(), path }));
    }

    /**
     * Убирает относительную часть пути файла
     * @param original оригинальный путь до файла
     * @returns нормализованный путь до файла
     */
    private _normalize(original: string): string {
        while(original.startsWith("..")) {
            original = original.substring(1);
        }
        return original;
    }
}

/**
 * Данные файла
 */
export type FileData = {
    /** Размер файла в байтах */
    size: number;
    /** Путь до файла */
    path: string;
    /** Признак того что вхожэдение является файлом */
    isFile: boolean;
}
