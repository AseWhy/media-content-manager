import { join, parse } from "path";
import { CONFIG, PROCESSING_DIR, VideoProcessingConfigRule, VideoProcessingOutputConfig } from "@const";
import { CustomerOrder, CustomerOrderProcessing, MediaProcessor } from "./mediaProcessor";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { VideoCustomerStreamConfig, VideoOutputConfig } from "@service/customerRegistry";
import { validate } from "jsonschema";
import { ffprobe } from "@service/ffmpeg";
import { VaInfo } from "@service/vaInfo";

import EventEmitter from "events";
import _ from "lodash";
import ffmpeg, { FfprobeData, FfprobeStream } from "fluent-ffmpeg";

/**
 * Ошибка обработки видео
 */
export class VideoProcessingError extends Error {

    /**
     * Конструктор
     * @param parent родительская ошибка
     * @param probe  данные о медиафайле
     */
    constructor(public readonly parent: Error, public readonly probe: FfprobeData) {
        super(parent.message);
    }
}

/**
 * Пост обработчик видеоконтента
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
        const probe: FfprobeData = await ffprobe(order.pathToMedia);
        // Высота и ширина видопотока
        const { width, height } = this._findVideoStream(probe.streams);

        // Исключенные потоки
        const filenameFunction = new Function("filename", "name", "ext", processingConfig.filenameFunction);
        const outputs = this._extractRequirementOutputConfiguration(outputConfig, width, height);
        const excludedStreams = await this._filterExcludedStreams(probe.streams, processingConfig, stream);
        const directory = join(PROCESSING_DIR, id);
        const result: string[] = [];

        if (!existsSync(directory)) {
            await mkdir(directory, { recursive: true });
        }

        const ffmpegBuilder = ffmpeg({ priority: CONFIG.priority })
            .input(order.pathToMedia)
            .addInputOptions("-hide_banner", "-v", "warning", "-stats", "-probesize", "10M");

        // Добавляем входящие параметры
        ffmpegBuilder.addInputOptions(processingConfig.additinalParams.input ?? []);

        for (const output of outputs) {
            const filePath = join(directory, filenameFunction(name, output.config.name, ".mkv"));

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
            ffmpegBuilder.addOutputOptions(_.chain([processingConfig.additinalParams.output, output.params])
                .flatMap(params => params ? params : [])
                .map(param => 
                    param.replace(/\$\{([aA-zZ0-9]+)\}/g, (_a, g1) => {
                        return output.data[g1];
                    })
                )
                .value());

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
                    ffmpegBuilder.once("error", error => {
                        this.emit("error", orderProcessing, new VideoProcessingError(error, probe));
                        res();
                    });
                    // При завершении обработки
                    ffmpegBuilder.once("end", async () => {
                        await this._onDone(orderProcessing);
                        res();
                    });
                    // При выходе
                    ffmpegBuilder.once("exit", () => console.log('Выход из обработчика видео'));

                    // При выводе ошибок
                    ffmpegBuilder.on("stderr", msg => {
                        if (msg.match(/^Error while processing the decoded data for stream #\d+:\d+$/)) {
                            ffmpegBuilder.emit("error", msg);
                        }
                        // Обрабатываем стандартный вывод
                        this._onStdOut(msg);
                    });
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
                        rej(new VideoProcessingError(new Error("Не найдены подходящие разрешения для конвертации"), probe));
                    }
                } catch(e) {
                    rej(new VideoProcessingError(e, probe));
                }
            });
        } catch (e) {
            this.emit("error", orderProcessing, e);
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
        let result: FfprobeStream[] = [];

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

        // Если есть схема фильтрации потоков, то используем её
        if (CONFIG.excludeStreamsSchema) {
            for (const stream of streams) {
                const valid = validate(stream, CONFIG.excludeStreamsSchema).valid;
                if (valid) {
                    continue;
                }

                console.warn(`Поток ${stream.id} был исключен, т.к. не попадает под схему фильтрации.`);

                result.push(stream);
            }
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
    private _extractRequirementOutputConfiguration(outputConfig: VideoOutputConfig, width: number,
        height: number): RequirementResolutionConfig[] {
        const result: RequirementResolutionConfig[] = [];

        for (const outputName of outputConfig.names) {
            const output = CONFIG.outputs[outputName];

            // Выход отключен
            if (output == null || output.enabled && !Function("width", "height", output.enabled)(width, height)) {
                continue;
            }

            // Добавляем конфигурацию выхода
            result.push({ config: output,
                data: this._extractData(output, { width, height }),
                params: this._extractParams(output) });
            
            // Если конфигурация выхода - это первый совпавший выход, то прерываем цикл
            if (outputConfig.mode === "first") {
                break;
            }
        }

        return result;
    }
    /**
     * Извлекает данные из конфигурации видео выхода
     * @param output конфигурация видио выхода
     * @param data   данные
     * @returns данные видио выхода
     */
    private _extractParams(output: VideoProcessingOutputConfig): string[] {
        const params = output.extend ? this._extractParams(this._getVideoConfig(output.extend)) : [];
        params.push(...output.additinalParams);
        return params;
    }

    /**
     * Извлекает данные из конфигурации видео выхода
     * @param output конфигурация видио выхода
     * @param data   данные
     * @returns данные видио выхода
     */
    private _extractData(output: VideoProcessingOutputConfig, data: Record<string, any> = {}): Record<string, any> {
        data = output.extend ? this._extractData(this._getVideoConfig(output.extend), data) : data;
        for (const key in output.data) {
            data[key] = Function(..._.keys(data), output.data[key])(..._.values(data));
        }
        return data;
    }

    /**
     * Возвращает конфигурация видио выхода
     * @param name наименование конфигурации видео выхода
     * @returns конфигурация видио выхода
     */
    private _getVideoConfig(name: string) {
        const found = CONFIG.outputs[name];
        if (found == null) {
            throw new Error(`Не удалось найти видео выход ${name}`);
        }
        return found;
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
type RequirementResolutionConfig = {
    /** Конфигурация видео выхода */
    config: VideoProcessingOutputConfig;
    /** Параметры выхода */
    params: string[];
    /** Данные видео выхода */
    data: Record<string, any>;
}
