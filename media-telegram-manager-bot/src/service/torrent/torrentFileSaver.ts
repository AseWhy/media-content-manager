import { basename, join } from "path";
import { copyFile, mkdir, rm } from "fs/promises";
import { CONFIG, ConfigCategoryName, MANAGED_DIR } from "../../constants";
import { existsSync } from "fs";
import { Container } from "typedi";
import { PostProcessCompleteOrder, ProcessingService } from "../processing/processingService";

/** Сервис постобработки */
const PROCESSING_SERVICE = Container.get(ProcessingService);

/**
 * Сохраняет файл
 * @param category       категория данных
 * @param path           путь до исходного файла
 * @param destinationDir путь до директории сохранения
 * @param name           имя файла, под которым он должен быть сохранен
 */
export async function saveFile(category: ConfigCategoryName, path: string, destinationDir: string, name: string): Promise<void> {
    if (CONFIG.postProcessing.enabled) {
        try {
            await PROCESSING_SERVICE.process({ type: category, path: { source: path, destination: destinationDir } }, name);
        } catch(e) {
            // Исключение
            console.error("Ошибка при добавлении файла на постобработку", e);
            // Сохраняем файл, чтобы зря не пропадал
            await _moveFile(path, destinationDir, name);
        }
    } else {
        await _moveFile(path, destinationDir, name);
    }
    await rm(path);
}

/**
 * Сохраняет файл
 * @param path           путь до исходного файла
 * @param destinationDir путь до директории сохранения
 * @param name           имя файла, под которым он должен быть сохранен
 */
async function _moveFile(path: string, destinationDir: string, name: string): Promise<void> {
    const managedDir = join(MANAGED_DIR, destinationDir);
    if (!existsSync(managedDir)) {
        await mkdir(managedDir, { recursive: true });
    }
    await copyFile(path, join(managedDir, name));
}

// Обрабатываем завершение постобработки
PROCESSING_SERVICE.on("done", async (order: PostProcessCompleteOrder) =>
    await Promise.all(order.files.map(file => _moveFile(file, order.order.path.destination, basename(file)))))