import { BOT_TOKEN } from "./constants";
import { Container } from "typedi";

import TelegramBot from "node-telegram-bot-api";

// Устанавливаем тг бота
Container.set(TelegramBot, new TelegramBot(BOT_TOKEN, { polling: true }))