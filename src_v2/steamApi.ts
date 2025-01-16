import type { GetAppList, GetNewsForApp, GetOwnedGames } from "./types.js";

export async function getNewsForAppId(appid: string | number, filterFeedNames?: string): Promise<GetNewsForApp.NewsItem[]> {
    console.log('Downloading news for app id', appid);
    
    const url = new URL('https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/');
    url.searchParams.append('format', 'json');
    url.searchParams.append('maxlength', '0');
    url.searchParams.append('count', '100');
    url.searchParams.append('appid', String(appid));

    if (filterFeedNames) {
        url.searchParams.append('feeds', filterFeedNames);
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
    }

    return ((await response.json()) as GetNewsForApp.Response).appnews.newsitems;
}

export async function getAppList() {
    console.log('Downloading steam app list...');

    const url = new URL('https://api.steampowered.com/ISteamApps/GetAppList/v2/');

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
    }

    const applist = Object.fromEntries(
        (await response.json() as GetAppList.Response).applist.apps.map(e => [e.appid, e])
    );

    return applist;
}

export async function getOwnedGames(steamIdOrVanity: string) {
    console.log('Downloading owned games list for', steamIdOrVanity);

    // https://steamcommunity.com/dev/apikey
    const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/');
    url.searchParams.append('key', process.env.STEAM_WEB_API_KEY!);
    url.searchParams.append('steamid', steamIdOrVanity);
    url.searchParams.append('format', 'json');

    const res = await fetch(url);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
    }

    return ((await response.json()) as GetOwnedGames.Response).response.games;
}