import path from 'node:path';
import fs from 'node:fs/promises';
import { generateRssFeed, newsItemToRssItem } from "./rss.js";
import type { GetAppList, GetNewsForApp } from "./types.js";

export async function publish(newsItemsByAppId: [appid: string[], newsItems: GetNewsForApp.NewsItem[]][], applist: Record<string, GetAppList.App>, outputPath?: string) { 
    outputPath ??= 'steam_news.xml';

    console.log('Generating RSS feed...');
    const rssitems = newsItemsByAppId
        .flatMap(([appids, newsitems]) => newsitems.map(newsItem => newsItemToRssItem(newsItem, appids, applist)))
        .filter(e => e !== undefined)
        .sort((a, b) => b.date.getTime() - a.date.getTime());

    const feed = generateRssFeed(rssitems);

    console.log(`Writing to ${outputPath}...`);

    const outputPathNoExtension = outputPath.slice(0, -path.extname(outputPath).length);

    await fs.writeFile(outputPath, feed.rss2().replace(
        '<?xml version="1.0" encoding="utf-8"?>',
        '<?xml version="1.0" encoding="utf-8"?>\n<?xml-stylesheet href="style.xsl" type="text/xsl"?>'
    ))

    await fs.writeFile(`${outputPathNoExtension}.atom`, feed.atom1());
    await fs.writeFile(`${outputPathNoExtension}.json`, feed.json1());

    await fs.copyFile('style.xsl', path.join(path.dirname(outputPath), 'style.xsl'))

    console.log('Published!');
}
