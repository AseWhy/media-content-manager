import { promisify } from "util";

import ffmpeg, { FfprobeData } from "fluent-ffmpeg";
import _ from "lodash";

/**
 * Выполняет пробу медиафайла
 * @param pathToMedia путь до медиафайла
 * @returns проба медиафайла
 */
export function ffprobe(pathToMedia: string): Promise<FfprobeData> {
    const command = ffmpeg(pathToMedia).addOption("-v", "warning");
    return promisify<FfprobeData>(command.ffprobe.bind(command))();
}