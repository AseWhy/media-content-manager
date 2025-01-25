import { basename, dirname, join } from "path";
import { copyFile, mkdir } from "fs/promises";
import { CONFIG, ConfigCategoryName, MANAGED_DIR } from "../../constants";
import { existsSync } from "fs";
import { Container } from "typedi";
import { PostProcessCompleteOrder, ProcessingService } from "../processing/processingService";

/** Сервис постобработки */
const PROCESSING_SERVICE = Container.get(ProcessingService);

/**
 * Сохраняет файл
 * @param category категория данных
 * @param src      путь до исходного файла
 * @param dest     путь до файла созранения
 * @param name     имя файла, под которым он должен быть сохранен
 * @param data     дополнительные данные
 */
export async function saveFile(category: ConfigCategoryName, src: string, dest: string, data: Record<string, string>): Promise<void> {
    if (CONFIG.postProcessing.enabled) {
        try {
            return await PROCESSING_SERVICE.process(src, dest, category, data);
        } catch(e) {
            // Исключение
            console.error("Ошибка при добавлении файла на постобработку", e);
        }
    }
    // Просто перемещаем файл
    await _moveFile(src, dest);
}

/**
 * Сохраняет файл
 * @param path путь до исходного файла
 * @param dest путь до файла созранения
 * @param name имя файла, под которым он должен быть сохранен
 */
async function _moveFile(src: string, dest: string): Promise<void> {
    const managedDirFilePath = join(MANAGED_DIR, dest);
    const managedDir = dirname(managedDirFilePath);
    if (!existsSync(managedDir)) {
        await mkdir(managedDir, { recursive: true });
    }
    await copyFile(src, managedDirFilePath);
}

// Обрабатываем завершение постобработки
PROCESSING_SERVICE.on("done", async (id: string, order: PostProcessCompleteOrder) =>
    await Promise.all(order.files.map(file => _moveFile(file, join(order.order.dest, basename(file))))))