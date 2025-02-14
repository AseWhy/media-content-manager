import { AdditionalDataHint } from "@const";

/**
 * Возвращает данные для варианта по умолчанию для imdb идентификатора
 * @param name наименование фильма или сериала
 * @returns данные для варианта по умолчанию для imdb идентификатора
 */
export async function fetchImdbId(name: string): Promise<AdditionalDataHint> {
    const response = await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(name)}.json`);
    if (response.status !== 200) {
        return [];
    }
    const data = await response.json();
    const dataArray: any[] = Array.isArray(data.d) ? data.d : [];
    return dataArray
        .filter(item => item.qid === 'movie' || item.qid === 'tvSeries')
        .map(item => ({ data: item.id, text: `${item.l} (${item.y})` }));
}