import 'reflect-metadata';

import { MediaPostProcessor } from "./service/postprocessing/mediaPostProcessor";
import { CustomerRegistry } from "./service/customerRegistry";
import { APP_PORT, PENDING_DIR, ProcessingType } from "./contants";
import { Container } from "typedi";
import { basename } from 'path';
import { createReadStream } from 'fs';
import { rm } from 'fs/promises';

import multer from 'multer';
import _ from "lodash";
import bodyparser from "body-parser";
import express from "express";
import FormData from 'form-data';

/** Сервер express */
const APP = express();

/** Директория загрузки */
const UPLOAD = multer({ dest: PENDING_DIR });

// Получение следующего элемента
APP.get("/pull/:customer", async (req, response) => {
    Container.get(MediaPostProcessor).pullCompleted(req.params.customer, completed => {
        return new Promise((res, rej) => {
            const form = new FormData();

            form.append("_id", completed.id);

            for (const current of completed.result) {
                form.append("files", createReadStream(current), encodeURIComponent(basename(current)));
            }

            const pipe = form.pipe(response.setHeader("Content-Type", `multipart/form-data; boundary=${form.getBoundary()}`));

            // При завершении обработки удаляем все файлы
            pipe.on("finish", () => rm(completed.directory, { recursive: true }).then(res));

            // При ошибке выбрасываем исключение
            pipe.on("error", rej);

            // При закрытии соединения отбрасываем
            response.on("unpipe", res);
        })
    }, () => response.end())
});

// Регистрация узла
APP.post("/register/:customer", bodyparser.json(), (req, res) => {
    // Добавляем заказчика в регистр
    Container.get(CustomerRegistry)
        .set(req.params.customer, req.body);

    // Успешный ответ
    res.send({ status: "ok" });
    res.end();
});

// Добавление медиафайла
APP.post("/add-media/:customer/:type", UPLOAD.single("file"), (req, res) => {
    const file = req.file;

    if (file == null) {
        res.send({ status: "err", reason: "Файл не передан" });
        res.end();
        return;
    }

    const type: ProcessingType = req.params.type as ProcessingType;
    const postProcessor = Container.get(MediaPostProcessor);
    const customerRegistry = Container.get(CustomerRegistry);
    const result = postProcessor.process({
        customer: req.params.customer,
        name: decodeURIComponent(file.originalname),
        pathToMedia: file.path,
        type,
        config: customerRegistry.get(req.params.customer).config[type]
    });

    res.send({ status: "ok", result });
    res.end();
});

// Слушаем на порту APP_PORT
const SERVER = APP.listen(APP_PORT, () => {
    // Реагируем на событие отключения
    process.once("exit",                SERVER.close.bind(SERVER));
    process.once("SIGINT",              SERVER.close.bind(SERVER));
    process.once("SIGUSR1",             SERVER.close.bind(SERVER));
    process.once("SIGUSR2",             SERVER.close.bind(SERVER));
    process.once("uncaughtException",   SERVER.close.bind(SERVER));

    // Уведомляем о запуске
    console.log(`Обработчик запущен на порту ${APP_PORT}`);
});

// Устанавливаем тайм-ауты
SERVER.headersTimeout = 0;
SERVER.requestTimeout = 0;

// Отображаем ошибки
process.once("uncaughtException", console.error);