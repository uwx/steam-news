export namespace GetNewsForApp {
    export interface Response {
        appnews: AppNews;
    }

    export interface AppNews {
        appid: number;
        newsitems: NewsItem[];
        count: number;
    }

    export interface NewsItem {
        gid: string;
        title: string;
        url: string;
        is_external_url: boolean;
        author: string;
        contents: string;
        feedlabel: string;
        date: number;
        feedname: string;
        feed_type: number;
        appid: number;
    }
}

export namespace GetAppList {
    export interface Response {
        applist: {
            apps: App[]
        }
    }

    export interface App {
        appid: number;
        name: string;
    }
}

export namespace GetOwnedGames {
    export interface Response {
        response: ResponseInner
    }

    export interface ResponseInner {
        game_count: number
        games: Game[]
    }

    export interface Game {
        appid: number
        playtime_forever: number
        playtime_windows_forever: number
        playtime_mac_forever: number
        playtime_linux_forever: number
        playtime_deck_forever: number
        rtime_last_played: number
        playtime_disconnected: number
        playtime_2_weeks?: number
    }
}
