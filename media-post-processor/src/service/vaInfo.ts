import { exec } from "child_process";

import _ from "lodash";

/** Информация о VA */
export class VaInfo {

    /**
     * Конструктор
     * @param version      версия vaaipi
     * @param libvaVersion версия libva
     * @param driver       драйвер
     * @param profiles     поддерживаемые профили
     */
    constructor(public readonly version: string, public readonly libvaVersion: string, public readonly driver: string,
        public readonly profiles: Record<VaInfoProfile, string[]>) {

    }

    /** Профили кодирования */
    public get encodeProfiles(): string[] {
        return _.chain(this.profiles)
            .entries()
            .filter(([ profile ]) => profile.includes("Enc"))
            .flatMap(profile => profile[1])
            .value();
    }

    /**
    * Возвращает информацию о видеодрайвере
    * @returns информация о видеодрайвере
    */
    public static get(): Promise<VaInfo> {
       return new Promise((res, rej) => {
           exec("vainfo --display drm", (error, stdout) => {
               if (error) {
                   return rej(error);
               }
               const vaHeaderInfo = /^vainfo: VA-API version: (\d{0,2}\.\d{0,2}) \(libva (\d{0,2}\.\d{0,2}\.\d{0,2})\)$\n^vainfo: Driver version: ([^\n]+)$/gm.exec(stdout);
               if (vaHeaderInfo == null) {
                   return rej(new Error("Не удалось получить информацию по vaapi"));
               }
               return res(new VaInfo(vaHeaderInfo[1], vaHeaderInfo[2], vaHeaderInfo[3],
                   _.chain(Array.from(stdout.matchAll(/^\s+([aA-zZ0-9]+)\s*:\t([aA-zZ]+)$/gm)))
                       .map(match => [match[1] as VaInfoProfile, match[2]])
                       .groupBy(data => data[1])
                       .mapValues(data => data.map(info => info[0]))
                       .value() as Record<VaInfoProfile, string[]>));
           });
       })
   }
}

/** VA профили */
export type VaInfoProfile = "VAEntrypointEncPicture" | "VAEntrypointVLD" | "VAEntrypointStats" | "VAEntrypointVideoProc" | "VAEntrypointEncSliceLP";
