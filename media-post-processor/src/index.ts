import 'reflect-metadata';

import { MediaPostProcessor } from "./service/postprocessing/mediaPostProcessor";
import { CustomerRegistry } from "./service/customerRegistry";
import { APP_PORT, PENDING_DIR, ProcessingType } from "@const";
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

/** Пост обработчик медиафайлов */
const MEDIA_POST_PROCESSOR = Container.get(MediaPostProcessor);

// Получение прогресса обработки
APP.get("/pull/info/:customer", (req, response) => {
    MEDIA_POST_PROCESSOR.pullInfo(req.params.customer, data => new Promise((res, rej) => {
        response.on("error", rej);
        response.on("finish", res);

        if (_.isEmpty(data)) {
            response.status(204).end();
        } else {
            response.json(data).end();
        }
    }));
});

// Получение следующих обработанных файлов
APP.get("/pull/files/:customer", (req, response) => {
    MEDIA_POST_PROCESSOR.pullCompleted(
        req.params.customer,
        completed => new Promise((res, rej) => {
            response.on("finish", res);
            response.on("error", rej);

            if (completed) {
                const form = new FormData();

                form.append("_id", completed.id);
    
                for (const current of completed.result) {
                    form.append("files", createReadStream(current), encodeURIComponent(basename(current)));
                }
                
                // Пишем форму в ответ
                form
                    .pipe(response
                        .status(200)
                        .setHeader("Content-Type", `multipart/form-data; boundary=${form.getBoundary()}`), { end: true })
                    .on("finish", res)
                    .on("error", rej);
            } else {
                response.status(204).end();
            }
        })
    );
});

// Регистрация узла
APP.post("/register/:customer", bodyparser.json(), (req, res) => {
    // Добавляем заказчика в регистр
    Container.get(CustomerRegistry)
        .set(req.params.customer, req.body);

    // Успешный ответ
    res.json({ status: "ok" }).end();
});

// Добавление медиафайла
APP.post("/add-media/:customer/:type", UPLOAD.single("file"), (req, res) => {
    const file = req.file;

    if (file == null) {
        res.json({ status: "err", reason: "Файл не передан" });
        return;
    }

    const type: ProcessingType = req.params.type as ProcessingType;
    const customerRegistry = Container.get(CustomerRegistry);

    res
        .json({
            status: "ok",
            result: MEDIA_POST_PROCESSOR.process({
                customer: req.params.customer,
                name: decodeURIComponent(file.originalname),
                pathToMedia: file.path,
                type,
                config: customerRegistry.get(req.params.customer).config[type]
            })
        })
    .end();
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