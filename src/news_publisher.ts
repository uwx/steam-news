// Generate RSS, see:
// https://cyber.harvard.edu/rss/rss.html
// https://docs.python.org/3.5/library/datetime.html
// https://pypi.python.org/pypi/PyRSS2Gen
// http://dalkescientific.com/Python/PyRSS2Gen.html

import { Feed as RssFeed, Item as RssItem } from "feed";
import * as fs from 'fs/promises';

function gen_rss_feed(rssitems: RssItem[]) {
    const pdate = new Date();
    const lbdate = new Date(Math.max(...rssitems.map(e => e.published!.getTime())));

    const feed = new RssFeed({
        id: 'Steam Game News',
        title: 'Steam Game News',
        link: 'http://store.steampowered.com/news/?feed=mygames',
        description: 'All of your Steam games\' news, combined!',
        updated: pdate,
        copyright: 'All rights reserved',
        // lastBuildDate: lbdate,
        ttl: 60*24,
    }); // TODO should ttl get a value?

    for (const item of rssitems) {
        feed.addItem(item);
    }

    return feed;
}

const FEEDTYPE_HTML = 0;
const FEEDTYPE_BBCODE = 1;

async function news_item_to_rss_item(newsitem: Selectable<NewsItem>, db: NewsDatabase) {
    let content: string;

    if (newsitem['feed_type'] == FEEDTYPE_BBCODE)
        content = convertBBCodeToHTML(newsitem['contents']!);
    else
        content = newsitem['contents']!;

    // Add the title of the game to the article title,
    //   but only if not present according to 'in' or difflib.get_close_matches.
    // get_close_matches isn't great for longer titles given the split() but /shrug
    // There are other libraries for fuzzy matching but difflib is built in...
    let games = await db.getSourceNamesAndAppIdForItem(newsitem['gid']);

    if (!await db.canFetchGames(games.map(e => e.appid))) {
        console.log(`Skipping article ${newsitem.title} because appid is not to be fetched now`);
        return undefined;
    }

    if (games.length == 0) {
        console.log(`Skipping article ${newsitem.title} because games.length == 0`);
        return undefined;
    }

    let rsstitle = newsitem['title'];
    if (games.length > 1)
        rsstitle = `[Multiple] ${rsstitle}`;
    else if (!rsstitle.includes(games[0].name))
        rsstitle = `[${games[0].name}] ${rsstitle}`
    // else game title is in article title, do nothing

    let source = newsitem['feedlabel']
    if (!source) {
        //patch over missing feedname in Steam News;
        // seems to be the only news source w/o feedlabels?
        if (newsitem['feedname'] == 'steam_community_blog')
            source = 'Steam Community Blog'
        else
            //shrug.
            source = newsitem['feedname'] || 'Unknown Source'
    }

    const sources = `<p><i>Via <b>${source}</b> for ${
        games.map(game => `<a href="https://store.steampowered.com/app/${game.appid}/">${game.name}</a>`).join(', ')
    }</i></p>\n`;

    return {
        title: rsstitle,
        link: newsitem['url']!,
        description: sources + content,
        author: newsitem['author'] ? [{ name: newsitem['author'] }] : undefined,
        id: newsitem['gid'],
        date: new Date(newsitem['date']*1000),
        published: new Date(newsitem['date']*1000),
        category: [{name: source}],
        //enclosure: games.length == 1 ? {
        //    title: games[0].name,
        //    url: `https://store.steampowered.com/app/${games[0].appid}/`
        //} : undefined
    } satisfies RssItem;
}

// RE: BBCode http://bbcode.readthedocs.org/
// note: feed_type is 1 for steam community announcements
//  (feedname usually == 'steam_community_announcements') and 0 otherwise
// this seems to be connected to the use of Steam's bbcode
// see https://steamcommunity.com/comment/Recommendation/formattinghelp
//
// Builtins: b, i, u, s, hr, sub, sup, list/*, quote (no author), code, center, color, url
// Steam: h1, h2, h3, b, u, i, strike, spoiler, noparse, url, list/*, olist/*, quote=author, code, table[tr[th, td]], previewyoutube
// More from Steam not in above url: img
// Adding: h1, h2, h3, strike, spoiler, noparse, olist (* already covered), table, tr, th, td, previewyoutube
// Ignoring special quote


// Spoiler CSS
`
span.bb_spoiler {
	color: #000000;
	background-color: #000000;

	padding: 0px 8px;
}

span.bb_spoiler:hover {
	color: #ffffff;
}

span.bb_spoiler > span {
	visibility: hidden;
}

span.bb_spoiler:hover > span {
	visibility: visible;
}
`;

import { parse as bbParse } from './bbcode.js';
import { NewsDatabase, NewsItem } from "./database.js";
import { Selectable } from "kysely";
import path from "node:path";

function convertBBCodeToHTML(text: string) {
    return bbParse(text)
        .replace(/{(STEAM_CLAN_IMAGE|STEAM_CLAN_LOC_IMAGE)}/g, match => IMG_REPLACEMENTS[match]);
}

// Community img tags frequently look like
// [img]{STEAM_CLAN_IMAGE}/27357479/d1048c635a5672f8efea79138bfd105b3cae552e.jpg[/img]
// which should translate to <img src="https://steamcdn-a.akamaihd.net/steamcommunity/public/images/clans/27357479/d1048c635a5672f8efea79138bfd105b3cae552e.jpg">
// e.g. {STEAM_CLAN_IMAGE} -> https://steamcdn-a.akamaihd.net/steamcommunity/public/images/clans
// as of late June? 2023, {STEAM_CLAN_IMAGE}/10546736/1a953901843868985238b9348f46da851c9e5665.png becomes
// https://clan.akamai.steamstatic.com/images//10546736/1a953901843868985238b9348f46da851c9e5665.png
//
// Steam News (official blog) has a newer tag type
// {STEAM_CLAN_LOC_IMAGE}/27766192/45e4984a51cabcc390f9e1c1d2345da97f744851.gif becomes...
// https://cdn.akamai.steamstatic.com/steamcommunity/public/images/clans/27766192/45e4984a51cabcc390f9e1c1d2345da97f744851.gif

// sort of makes me wonder if these are interchangable...
const IMG_REPLACEMENTS = {
    '{STEAM_CLAN_IMAGE}': 'https://clan.akamai.steamstatic.com/images/',
    '{STEAM_CLAN_LOC_IMAGE}': 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/clans',
};

export async function publish(db: NewsDatabase, output_path?: string) {
    output_path ??= 'steam_news.xml';

    console.log('Generating RSS feed...')
    const rssitems = (await Promise.all((await db.getNewsRows()).map(async row => await news_item_to_rss_item(row, db))))
        .filter(e => e !== undefined);
    const feed = gen_rss_feed(rssitems);

    console.log(`Writing to ${output_path}...`);

    const outputPathNoExtension = output_path.slice(0, -path.extname(output_path).length);

    await fs.writeFile(output_path, feed.rss2().replace(
        '<?xml version="1.0" encoding="utf-8"?>',
        '<?xml version="1.0" encoding="utf-8"?>\n<?xml-stylesheet href="style.xsl" type="text/xsl"?>'
    ))

    await fs.writeFile(outputPathNoExtension + '.atom', feed.atom1());
    await fs.writeFile(outputPathNoExtension + '.json', feed.json1());

    await fs.copyFile('style.xsl', path.join(path.dirname(output_path), 'style.xsl'))

    console.log('Published!');
}
