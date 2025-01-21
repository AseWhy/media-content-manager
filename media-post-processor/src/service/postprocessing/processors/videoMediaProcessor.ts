import { join, parse } from "path";
import { CONFIG, PROCESSING_DIR, ProcessingResolutions, VideoProcessingOutputConfig } from "../../../contants";
import { CustomerOrder, CustomerOrderProcessing, MediaProcessor } from "./mediaProcessor";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";

import EventEmitter from "events";
import _ from "lodash";
import ffmpeg, { FfprobeStream } from "fluent-ffmpeg";

/**
 * пост обработчик видеоконтента
 */
export class VideoMediaProcessor extends EventEmitter implements MediaProcessor {
    
    /** @inheritDoc */
    async process(id: string, order: CustomerOrder): Promise<void> {
        const { resolutions } = order.config;
        const { name } = parse(order.name);

        // Функция прогресса
        const onProgress = _.throttle(args => console.log(`Прогресс конвертации ${id}: ${args.percent.toFixed(2)}%, ${args.timemark}, обработано ${args.frames} кадров`),
            5000);

        return new Promise((res, rej) => {
            ffmpeg(order.pathToMedia).addOption("-v", "warning").ffprobe(async (err, data) => {
                if (err) {
                    return rej(err);
                }

                try {
                    const { width, height } = this._findVideoStream(data.streams);
                    const { filenameFunction: filenameFunctionStr, outputs, additinalParams } = CONFIG.processing.movies;

                    // Исключенные потоки
                    const filenameFunction = new Function("filename", "name", "ext", filenameFunctionStr);
                    const excludedStreams = this._filterExcludedStreams(data.streams, order.config);
                    const ratio = (width / height).toFixed(2);
                    const directory = join(PROCESSING_DIR, id);
                    const result: string[] = [];

                    if (!existsSync(directory)) {
                        await mkdir(directory, { recursive: true });
                    }

                    const ffmpegBuilder = ffmpeg({ priority: CONFIG.priority, cwd: "" })
                        .addOptions("-hide_banner", "-v", "warning", "-stats")
                        .input(order.pathToMedia)
                        .addInputOptions("-probesize", "10M");

                    // Обрабатываем входящие параметры
                    this._processInputOptions(ffmpegBuilder, outputs);

                    for (const config of outputs) {
                        // Если конфигурация не используется
                        if (!resolutions.includes(config.name)) {
                            continue;
                        }

                        // Ищем конфигурацию с таким же разрешением экрана
                        const sampleResolution = config.resolutions.find(
                            ([ width, height ]) => (width / height).toFixed(2) === ratio);
                        
                        // Если высота выхода конфигурации больше высоты потока или если конфигурация не найдена
                        if (!sampleResolution || sampleResolution[0] > width) {
                            continue;
                        }

                        const filePath = join(directory, filenameFunction(name, config.name, ".mkv"));

                        ffmpegBuilder
                            .addOutput(filePath)
                            .addOutputOption("-preset", config.preset)
                            .audioCodec("copy")
                            .addOutputOption("-scodec", "copy")
                            // Берем все потоки из входа 0
                            .addOutputOption("-map", "0");

                        if (additinalParams) {
                            ffmpegBuilder.addOutputOptions(additinalParams);
                        }
                        for (const stream of excludedStreams) {
                            // Исключаем некоторые потоки из входа 0
                            ffmpegBuilder.addOutputOption("-map", `-0:${stream.index}`);
                        }

                        this._processOutputOptions(ffmpegBuilder, config, width, height, sampleResolution[0], sampleResolution[1]);

                        result.push(filePath);
                    }

                    const orderProcessing = { ...order, directory, result, id };

                    // Вешаем слушатели на процесс ffmpeg
                    ffmpegBuilder.once("error", rej);
                    ffmpegBuilder.once("end", this._onDone.bind(this, orderProcessing));
                    ffmpegBuilder.once("end", res);
                    ffmpegBuilder.once('exit', () => console.log('Video recorder exited'));
                    
                    // При выводе ошибок
                    ffmpegBuilder.on("stderr", this._onStdOut.bind(this));

                    // Действие при прогрессе загрузки
                    ffmpegBuilder.on("progress", onProgress);
                    
                    // При выходе из программы убиваем процесс ffmpeg
                    const kill = () => ffmpegBuilder.kill("SIGKILL");

                    process.once("exit", kill);
                    process.once("SIGINT", kill);
                    process.once("SIGUSR1", kill);
                    process.once("SIGUSR2", kill);
                    process.once("uncaughtException", kill);

                    // Выводим команду запуска
                    console.log("Добавлена постобработка", ffmpegBuilder._getArguments().join(" "));
                    
                    if (result.length > 0) {
                        // Запускаем обработку
                        ffmpegBuilder.run();
                    } else {
                        console.log("Не найдены подходящие разрешения для конвертации");
                        return rej();
                    }
                } catch(e) {
                    return rej(e);
                }
            });
        });
    }

    /**
     * Обробатывает входящие параметры ffmpeg
     * @param ffmpegBuilder билдер задачи ffmpeg
     * @param config        конфигурация
     */
    private _processOutputOptions(ffmpegBuilder: ffmpeg.FfmpegCommand, config: VideoProcessingOutputConfig<ProcessingResolutions>,
        width: number, height: number, sampleWidth: number, sampleHeight: number) {
        // TODO пенести в конфигурацию, для большей гибкости
        if (width === sampleWidth && height === sampleHeight) {
            ffmpegBuilder.videoCodec("copy")
                .addOutputOption("-s", `${sampleWidth}x${sampleHeight}`);
        } else {
            ffmpegBuilder.videoCodec(config.codec);
            if (config.codec.includes("vaapi")) {
                // Масштабирование с помощью hwa
                ffmpegBuilder.addOutputOptions("-vf", `scale_vaapi=w=${sampleWidth}:h=${sampleHeight}`);
            }
        }
    }

    /**
     * Обрабатывает параметры выхода ffmpeg
     * @param ffmpegBuilder билдер задачи ffmpeg
     * @param outputs       конфигурация выходов
     */
    private _processInputOptions(ffmpegBuilder: ffmpeg.FfmpegCommand, outputs: VideoProcessingOutputConfig<ProcessingResolutions>[]) {
        if (outputs.some(e => e.codec.includes("vaapi"))) {
            // Добавляем опции запуска для аппаратного ускорения
            ffmpegBuilder.addInputOptions('-hwaccel', 'vaapi', '-hwaccel_output_format',
                'vaapi', '-vaapi_device', '/dev/dri/renderD128');
        }
    }

    /**
     * Действие при выводе данных ffmpeg в поток std
     * @param data данные
     */
    private _onStdOut(data: string) {
        if (data.startsWith("frame=")) {
            return;
        }
        console.error(data);
    }
    
    /**
     * Действие при прогрессе выполнения обработки медиафайла
     * @param processing обрабатываемый медиафайл
     */
    private async _onDone(processing: CustomerOrderProcessing) {
        // Помечаем как исполненный
        this.emit("done", processing);
        // Удаляем медиафайл
        await rm(processing.pathToMedia);
    }

    /**
     * Возвращает первый найденный видеопоток
     * @param streams потоки
     * @returns первый найденный видеопоток
     */
    private _findVideoStream(streams: FfprobeStream[]): any {
        // Видеопоток
        const videoStream = streams.find(e => e.codec_type === 'video');
        if (videoStream == null) {
            throw new Error("Видео поток не найден");
        }
        return videoStream;
    }

    /**
     * Возвращает исключенные из медиафайла потоки
     * @param streams потоки
     * @param config  конфигурация
     * @returns исключенные из медиафайла потоки
     */
    private _filterExcludedStreams(streams: FfprobeStream[], config: VideoMediaConfiguration) {
        return streams.filter(e => {
            if (e.tags) {
                if (e.codec_type === "audio") {
                    return !Object.values<string>(e.tags)
                        .some(audioTag => config.allowedaudio.contains.some(allowed => audioTag.includes(allowed)));
                } else if (e.codec_type === "subtitle") {
                    return !Object.values<string>(e.tags)
                        .some(subTag => config.allowedsubs.contains.some(allowed => subTag.includes(allowed)));
                }
            }
            return false;
        });
    }
}

/**
 * Интерфейс поиска совпадающих значений
 */
export type VideoMediaMatchConfig = {
    contains: string[];
};

/**
 * Конфигурация постобработки видео
 */
export type VideoMediaConfiguration = {
    /** Допустимые разрешения */
    resolutions: ProcessingResolutions;
    /** Допустимые субтитры */
    allowedsubs: VideoMediaMatchConfig;
    /** Допустимые аудиодорожки */
    allowedaudio: VideoMediaMatchConfig;
};