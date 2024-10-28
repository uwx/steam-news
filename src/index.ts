import 'dotenv/config';

import { parse } from 'ts-command-line-args';
import { NewsDatabase, NewsItem } from './database.js';
import * as fs from 'fsxt';
import { Selectable } from 'kysely';
import { publish } from './news_publisher.js';

// Hardcoded list of AppIDs that return news related to Steam as a whole (not games)
// Mileage may vary. Use app_id_discovery.py to maybe find more of these...
const STEAM_APPIDS = {
    '753': 'Steam',
    '221410': 'Steam for Linux',
    '223300': 'Steam Hardware',
    '250820': 'SteamVR',
    '353370': 'Steam Controller',
    '353380': 'Steam Link',
    '358720': 'SteamVR Developer Hardware',
    '596420': 'Steam Audio',
    // 593110 is the source for the megaphone icon in the client, not in appid list...
    '593110': 'Steam News',
    '613220': 'Steam 360 Video Player'
};

async function seedDatabase(id_or_vanity: string, db: NewsDatabase, minimum_playtime?: number, last_6_months_only: boolean = false) {
    // https://steamcommunity.com/dev/apikey
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env["STEAM_WEB_API_KEY"]}&steamid=${id_or_vanity}&format=json`;

    const [newsids, games_full] = await get_app_ids_from_url(url);

    // Also add the hardcoded ones...
    for (const [k, v] of Object.entries(STEAM_APPIDS)) {
        newsids[Number(k)] = v;
    }
    await db.addGames(newsids);

    // set should_fetch to whether last played <6mo ago and >minimum_playtime
    if (last_6_months_only || minimum_playtime !== undefined) {
        let six_months_ago = new Date();
        six_months_ago.setMonth(six_months_ago.getMonth() - 6);

        await db.setFetchingIds(
            Object.entries(games_full)
                .map(([appid, game]) => [
                    Number(appid),
                    ((
                        !last_6_months_only || new Date(game.rtime_last_played*1000) >= six_months_ago
                    ) && (
                        minimum_playtime === undefined || game.playtime_forever >= minimum_playtime
                    )) || appid in STEAM_APPIDS // add exception for steam_appids
                ]
            )
        );
    }
}

interface GetAppListResult {
    applist: {
        apps: GetAppListResult_App[]
    }
}

interface GetAppListResult_App {
    appid: number;
    name: string;
}

interface GetOwnedGamesResult {
    response: GetOwnedGamesResult_Response
}

interface GetOwnedGamesResult_Response {
    game_count: number
    games: GetOwnedGamesResult_Game[]
}

interface GetOwnedGamesResult_Game {
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

let applist: Record<number, string> | undefined = undefined;

async function get_app_ids_from_url(url: string) {
    // """Given a steam profile url, produce a dict of
    // appids to names of games owned (appids are strings)
    // Note that the profile in question needs to be public for this to work!"""
    console.log(`Parsing JSON from ${url}...`)

    if (!applist) {
        console.log('Downloading steam app list...');
        const res: GetAppListResult = await fetch('https://api.steampowered.com/ISteamApps/GetAppList/v2/')
            .then(e => e.json())

        applist = Object.fromEntries(res.applist.apps.map(e => [e.appid, e.name]));
    }

    let games: Record<number, string> = {}
    let games_full: Record<number, GetOwnedGamesResult_Game> = {}

    const res = await fetch(url);

    if (res.ok) {
        const j: GetOwnedGamesResult = await res.json();
        console.log(j);

        for (const ge of j.response.games) {
            const appid = ge['appid'];
            const name = appid in applist ? applist[appid] : ''+appid;
            games[appid] = name;
            games_full[appid] = ge;
        }
    }

    console.log(`Found ${Object.entries(games).length} games.`);
    return [games, games_full] as const;
}

interface AppNews {
    appid: number;
    newsitems: (Selectable<NewsItem> & { realappid: number })[];
}

interface News {
    appnews: AppNews;
    expires: number;
}

interface NewsError {
    error: string;
}

function get_expires_datetime_from_response(response: Response) {
    const exp = response.headers.get('Expires')
    return exp ? new Date(exp) : new Date();
}

async function get_news_for_appid(appid: number, filter_feed_names?: string): Promise<News | NewsError> {
    // """Get news for the given appid as a dict"""
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?format=json&maxlength=0&count=10&appid=${appid}${filter_feed_names ? `&feeds=${filter_feed_names}` : ""}`

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`${response.status}: ${response.statusText}`);
        }

        // Get value of 'expires' header as a datetime obj
        const exdt = get_expires_datetime_from_response(response)
        // Parse the JSON
        const news: News = await response.json();
        // Add the expire time to the group as a plain unix time
        news['expires'] = Math.round(exdt.getTime()/1000)
        // Decorate each news item and the group with its "true" appid
        for (const newsitem of news['appnews']['newsitems']) {
            newsitem['realappid'] = appid;
        }

        return news;
    } catch (err) {
        return {'error': `${err}`};
    }
}

const sleep = (sec: number) => new Promise(resolve => setTimeout(resolve, sec*1000));

function is_news_old(ned: Selectable<NewsItem>) {
    // """Is this news item more than 30 days old?"""
    const newsdt = new Date(ned['date']*1000)
    let thirtyago = new Date();
    thirtyago.setDate(thirtyago.getDate() - 30);
    return newsdt < thirtyago;
}

function save_recent_news(news: News, db: NewsDatabase) {
    // """Given a single news dict from getNewsForAppID,
    // save all "recent" news items to the DB"""
    db.updateExpireTime(news['appnews']['appid'], news['expires']);

    let current_entries = 0;
    for (const ned of news['appnews']['newsitems']) {
        if (!is_news_old(ned)) {
            db.insertNewsItem(ned);
            current_entries += 1;
        }
    }

    return current_entries;
}

async function get_all_recent_news(newsids: Record<number, string>, db: NewsDatabase, filter_feed_names: string | undefined) {
    // """Given a dict of appids to names, store all "recent" items, respecting the cache"""
    let cache_hits = 0;
    let new_hits = 0;
    let fails = 0;
    let idx = 0;
    let total_current = 0;

    const newsidsLen = Object.entries(newsids).length;
    for (const [aidString, name] of Object.entries(newsids)) {
        const aid = Number(aidString);

        idx += 1;
        if (await db.isNewsCached(aid)) {
            console.log(`[${idx}/${newsidsLen}] Cache for ${aid}: ${name} still valid!`);
            cache_hits += 1
            continue
        }

        const news = await get_news_for_appid(aid, filter_feed_names);
        if ('appnews' in news) { // success
            const cur_entries = save_recent_news(news, db);
            new_hits += 1;
            if (cur_entries) {
                console.log(`[${idx}/${newsidsLen}] Fetched ${aid}: ${name} OK; ${cur_entries} current items`);
                total_current += cur_entries;
            } else {
                console.log(`[${idx}/${newsidsLen}] Fetched ${aid}: ${name} OK; nothing current`);
            }
            await sleep(0.25);
        } else {
            fails += 1;
            console.error(`[${idx}/${newsidsLen}] ${aid}: ${name} fetch error: ${news.error}`);
            await sleep(1);
        }
    }
    console.log(`Run complete. ${cache_hits} cached, ${new_hits} fetched, ${fails} failed; ${total_current} current news items`);
}

interface IArguments {
    first_run: boolean,
    add_profile_games?: string,
    last_6_months_only: boolean,
    minimum_playtime?: number,
    fetch: boolean,
    publish?: string,
    edit_games_like?: string,
    verbose: boolean,
    db_path: string,
    filter_feed_names?: string,
}

export const args = parse<IArguments>({
    first_run: { type: Boolean },
    add_profile_games: { type: String, optional: true, typeLabel: 'Steam ID|Vanity url' },
    last_6_months_only: { type: Boolean, description: 'when using --add-profile-games, omit games not played in the last 6 months' },
    minimum_playtime: { type: Number, optional: true, description: 'when using --add-profile-games, minimum playtime to consider', typeLabel: 'minutes' },
    fetch: { type: Boolean, alias: 'f' },
    publish: { type: String, alias: 'p', optional: true, typeLabel: 'XML output path' },
    edit_games_like: { type: String, alias: 'g', optional: true, typeLabel: 'partial name of game' },
    verbose: { type: Boolean, alias: 'v' },
    db_path: { type: String, defaultValue: 'SteamNews.db' },
    filter_feed_names: { type: String, optional: true },
});

const isDbUninitialized = !await fs.exists(args.db_path);
await using db = new NewsDatabase(args.db_path);

if (args.add_profile_games)
    await seedDatabase(args.add_profile_games, db, args.minimum_playtime, args.last_6_months_only);

if (args.edit_games_like) {
    // edit_fetch_games(args.edit_games_like, db)
    // not implemented!
} else { // editing is mutually exclusive w/ fetch & publish
    if (args.fetch) {
        const newsids = await db.getFetchGames();
        await get_all_recent_news(newsids, db, args.filter_feed_names)
    }

    if (args.publish) {
        await publish(db, args.publish)
    }
}