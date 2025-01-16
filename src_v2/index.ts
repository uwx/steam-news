import 'dotenv/config';
import { parse } from "ts-command-line-args";
import { getAppList, getNewsForAppId, getOwnedGames } from "./steamApi.js";
import type { GetNewsForApp } from "./types.js";
import { publish } from "./publish.js";
import path from 'node:path';

interface IArguments {
    first_run: boolean,
    profile: string,
    last_6_months_only: boolean,
    minimum_playtime?: number,
    publish?: string,
    verbose: boolean,
    db_path: string,
    filter_feed_names?: string,
}

export const args = parse<IArguments>({
    first_run: { type: Boolean },
    profile: { type: String, typeLabel: 'Steam ID|Vanity url' },
    last_6_months_only: { type: Boolean, description: 'when using --add-profile-games, omit games not played in the last 6 months' },
    minimum_playtime: { type: Number, optional: true, description: 'when using --add-profile-games, minimum playtime to consider', typeLabel: 'minutes' },
    publish: { type: String, alias: 'p', optional: true, typeLabel: 'XML output path' },
    verbose: { type: Boolean, alias: 'v' },
    db_path: { type: String, defaultValue: 'SteamNews.db' },
    filter_feed_names: { type: String, optional: true },
});

const applist = await getAppList();
const ownedGames = await getOwnedGames(args.profile);

const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

const allNewsItems: (GetNewsForApp.NewsItem & { realappid: number })[] = [];

for (const game of ownedGames) {
    if (args.minimum_playtime !== undefined && game.playtime_forever < args.minimum_playtime)
        continue;
    if (args.last_6_months_only !== undefined && game.rtime_last_played * 1000 < sixMonthsAgo.getTime())
        continue;

    const newsItems = await getNewsForAppId(game.appid, args.filter_feed_names);
    allNewsItems.push(...newsItems.map(e => Object.assign(e, { realappid: game.appid })));
}

// deduplicate news items by gid and combine realappid of each into appids
const newsItemsByAppIds = Object.values(
    Object.groupBy(allNewsItems, newsItem => newsItem.gid)
)
    .map(newsItems => ({
        ...newsItems![0],
        appids: newsItems?.map(e => e.realappid) ?? []
    }));

// gorup news items by appids
const groupedNewsItemsByAppIds: [appid: string[], newsItems: GetNewsForApp.NewsItem[]][] = Object.values(
    Object.groupBy(newsItemsByAppIds, e => e.appids.join(','))
)
    .map(newsItems => [
        newsItems![0].appids.map(String),
        newsItems!
    ] as const);

await publish(groupedNewsItemsByAppIds, applist, args.publish);

for (const newsItems of Object.values(Object.groupBy(allNewsItems, newsItem => newsItem.realappid))) {
    const appid = String(newsItems![0].realappid);
    await publish([[[appid], newsItems!] as const], applist, path.join(path.dirname(args.publish ?? ''), `${appid}.xml`));
}