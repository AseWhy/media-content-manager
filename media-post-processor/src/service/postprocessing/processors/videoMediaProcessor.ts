import { join, parse } from "path";
import { CONFIG, PROCESSING_DIR, VideoProcessingConfigRule, VideoProcessingOutputConfig } from "../../../contants";
import { CustomerOrder, CustomerOrderProcessing, MediaProcessor } from "./mediaProcessor";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { VideoCustomerStreamConfig, VideoOutputConfig } from "../../customerRegistry";
import { validate } from "jsonschema";
import { ffprobe } from "../../ffmpeg";
import { VaInfo } from "../../vaInfo";

import EventEmitter from "events";
import _ from "lodash";
import ffmpeg, { FfmpegCommand, FfprobeData, FfprobeStream } from "fluent-ffmpeg";

/**
 * пост обработчик видеоконтента
 */
export class VideoMediaProcessor extends EventEmitter implements MediaProcessor {

    /** @inheritDoc */
    async process(id: string, order: CustomerOrder): Promise<void> {
        const { name } = parse(order.name);
        const { outputs: outputConfig, stream } = order.config;

        // Конфигурация постобработки
        const processingConfig = CONFIG.processing[order.type];
        // Функция прогресса
        const onProgress = _.throttle(this._onProgress.bind(this, id, order), 5000, { trailing: false });

        // Данные медиафайла
        const { streams }: FfprobeData = await ffprobe(order.pathToMedia);
        // Высота и ширина видопотока
        const { width, height } = this._findVideoStream(streams);

        // Исключенные потоки
        const filenameFunction = new Function("filename", "name", "ext", processingConfig.filenameFunction);
        const outputs = this._extractRequirementOutputConfiguration(outputConfig, width, height, processingConfig.outputs);
        const excludedStreams = await this._filterExcludedStreams(streams, processingConfig, stream);
        const directory = join(PROCESSING_DIR, id);
        const result: string[] = [];

        if (!existsSync(directory)) {
            await mkdir(directory, { recursive: true });
        }

        const ffmpegBuilder = ffmpeg({ priority: CONFIG.priority })
            .input(order.pathToMedia)
            .addInputOptions("-hide_banner", "-v", "warning", "-stats", "-probesize", "10M");

        // Добавляем входящие параметры
        this._addInputOptions(ffmpegBuilder, processingConfig);

        for (const output of outputs) {
            const filePath = join(directory, filenameFunction(name, output.name, ".mkv"));

            ffmpegBuilder
                .addOutput(filePath)
                .videoCodec(processingConfig.videoCodec)
                .audioCodec(processingConfig.audioCodec)
                .addOutputOption("-scodec", "copy")
                // Берем все потоки из входа 0
                .addOutputOption("-map", "0");

            for (const stream of excludedStreams) {
                // Исключаем некоторые потоки из входа 0
                ffmpegBuilder.addOutputOption("-map", `-0:${stream.index}`);
            }
            
            // Добавляем параметры выхода
            this._addOutputOptions(ffmpegBuilder, processingConfig, output.sampleWidth, output.sampleHeight);

            result.push(filePath);
        }

        /** Данные обрабатываемого заказа */
        const orderProcessing = { ...order, directory, result, id };

        // Выводим команду запуска
        console.log("Добавлена постобработка", `${width}:${height}`, _.chain(ffmpegBuilder._getArguments())
            .map(e => _.toString(e))
            .map(e => e.includes(" ") ? `'${e.replace(/'/g, "\\'")}'` : e).join(" ")
            .value());

        try {
            await new Promise<void>((res, rej) => {
                try {
                    // Вешаем слушатели на процесс ffmpeg
                    ffmpegBuilder.once("error", this.emit.bind(this, "error", orderProcessing));
                    ffmpegBuilder.once('exit', () => console.log('Выход из обработчика видео'));
                    ffmpegBuilder.once("end", async () => {
                        await this._onDone(orderProcessing);
                        res();
                    });
                    
                    // При выводе ошибок
                    ffmpegBuilder.on("stderr", this._onStdOut.bind(this,));

                    // Действие при прогрессе загрузки
                    ffmpegBuilder.on("progress", onProgress);
                    
                    // При выходе из программы убиваем процесс ffmpeg
                    const kill = () => ffmpegBuilder.kill("SIGKILL");

                    process.once("exit",                kill);
                    process.once("SIGINT",              kill);
                    process.once("SIGUSR1",             kill);
                    process.once("SIGUSR2",             kill);
                    process.once("uncaughtException",   kill);
                    
                    if (result.length > 0) {
                        // Запускаем обработку
                        ffmpegBuilder.run();
                    } else {
                        rej(new Error("Не найдены подходящие разрешения для конвертации"));
                    }
                } catch(e) {
                    rej(e);
                }
            });
        } catch (e) {
            this.emit("error", orderProcessing, e.message);
        }
    }

    /**
     * Добавляет параметры выхода ffmpeg
     * @param ffmpegBuilder    билдер задачи ffmpeg
     * @param processingConfig конфигурация постобработки
     */
    private _addInputOptions(ffmpegBuilder: FfmpegCommand, { additinalParams: { input } }: VideoProcessingConfigRule) {
        if (input) {
            ffmpegBuilder.addInputOptions(input);
        }
    }

    /**
     * Добавляет входящие параметры ffmpeg
     * @param ffmpegBuilder    билдер задачи ffmpeg
     * @param processingConfig конфигурация постобработки
     * @param sampleWidth      требуемая ширина видеопотока
     * @param sampleHeight     требуемая высота видеопотока
     */
    private _addOutputOptions(ffmpegBuilder: FfmpegCommand, { additinalParams: { output } }: VideoProcessingConfigRule,
        sampleWidth: number, sampleHeight: number) {
        if (output) {
            ffmpegBuilder.addOutputOptions(output.map(option => option.replace("${sampleWidth}", _.toString(sampleWidth))
                .replace("${sampleHeight}", _.toString(sampleHeight))));
        }
    }

    /**
     * Действие при прогрессе обработки
     * @param id       идентификатор медиафайла
     * @param order    заказ на обработку
     * @param progress данные прогресса обработки
     */
    private _onProgress(id: string, order: CustomerOrder, progress: ProgressData) {
        if (progress.percent) {
            console.log(`Прогресс конвертации ${id}: ${progress.percent.toFixed(2)}%, ${
                progress.timemark}, обработано ${progress.frames} кадров`);
        } else {
            console.log(`Прогресс конвертации ${id}: ${progress.timemark}, обработано ${progress.frames} кадров`);
        }
        // Публикуем событие
        this.emit("progress", id, order, progress);
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
     * @param streams          потоки
     * @param processingConfig конфигурация постобработки
     * @param config           конфигурация
     * @returns исключенные из медиафайла потоки
     */
    private async _filterExcludedStreams(streams: FfprobeStream[], processingConfig: VideoProcessingConfigRule,
        config: VideoCustomerStreamConfig) {

        const groups = _.groupBy(streams, e => e.codec_type);
        const result: FfprobeStream[] = [];

        if (groups.audio) {
            const streams = groups.audio.filter(stream => !validate(stream, config.audio).valid);

            if (streams.length !== groups.audio.length) {
                result.push(...streams);
            } else {
                console.log(`Другие потоки аудио кроме ${streams.map(e => `'${e.tags?.title} [${e.codec_name}]'`).join(", ")} не найдены. Кодеки аудио не будут исключены из медиа.`);
            }
        }

        if (groups.subtitle) {
            const streams = groups.audio.filter(stream => !validate(stream, config.subtitle).valid);

            if (streams.length !== groups.subtitle.length) {
                result.push(...streams);
            } else {
                console.log(`Другие потоки субтитров кроме ${streams.map(e => `'${e.tags?.title} [${e.codec_name}]'`).join(", ")} не найдены. Кодеки субтитров не будут исключены из медиа.`);
            }
        }

        if (groups.video.length > 1) {
            // Если используется кодек vaapi
            if (processingConfig.videoCodec.includes("vaapi")) {
                const vainfo = await VaInfo.get();

                console.log("Получены данные vaapi", vainfo);

                // Если текущий обработчик vaapi не поддерживает mjpeg, однако поток с ним имеется, то исключаем этот поток
                if (!vainfo.encodeProfiles.some(profile => profile.includes("VAProfileMPEG"))) {
                    result.push(...groups.video.filter(e => e.codec_name === "mjpeg"));
                }
            }
            // TODO: Может добавить обработку других кодеков
        }

        return _.uniq(result);
    }

    /**
     * Извлекает требуемую конфигурацию видеовыходов
     * @param resolutions необходимые разрешения выходов
     * @param width       ширина исходного потока
     * @param height      высота исходного потока
     * @param outputs     конфигурация выходов
     * @returns требуемую конфигурацию видеовыходов
     */
    private _extractRequirementOutputConfiguration(outputConfig: VideoOutputConfig, width: number, height: number,
        outputs: VideoProcessingOutputConfig[]): RequirementResolutionConfig[] {

        const result: RequirementResolutionConfig[] = [];
        const ratio = (width / height).toFixed(2);

        for (const output of _.reverse(outputs)) {
            // Исключаем ненужные выходы
            if (!outputConfig.names.includes(output.name)) {
                continue;
            }

            // Ищем конфигурацию с таким же разрешением экрана
            const sampleResolution = output.resolutions.find(
                ([ width, height ]) => (width / height).toFixed(2) === ratio);
            
            // Если высота выхода конфигурации больше высоты потока или если конфигурация не найдена
            if (!sampleResolution || sampleResolution[0] > width) {
                continue;
            }
    
            result.push({ ...output, sampleWidth: sampleResolution[0], sampleHeight: sampleResolution[1] });
            
            // Если конфигурация выхода - это первый совпавший выход, то прерываем цикл
            if (outputConfig.mode === "first" && outputConfig.names.includes(output.name)) {
                break;
            }
        }

        return result;
    }
}

/**
 * Данные прогресс обаботки
 */
export type ProgressData = {
    /** Количество обработанных кадров */
    frames: number;
    /** Текущее количество обрабатываемых кадров в секунду */
    currentFps: number;
    /** Текущий битрейт */
    currentKbps: number;
    /** Целевой размер */
    targetSize: number;
    /** Текущая метка времени обработанного медиафайла */
    timemark: string;
    /** Процент обработки */
    percent?: number;
};

/**
 * Требуемая конфигурация видео выхода
 */
type RequirementResolutionConfig = VideoProcessingOutputConfig & {
    /** Требуемая ширина потока */
    sampleWidth: number;
    /** Требуемая высота потока */
    sampleHeight: number;
}
