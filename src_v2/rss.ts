// Generate RSS, see:
// https://cyber.harvard.edu/rss/rss.html
// https://docs.python.org/3.5/library/datetime.html
// https://pypi.python.org/pypi/PyRSS2Gen
// http://dalkescientific.com/Python/PyRSS2Gen.html

import { Feed as RssFeed, type Item as RssItem } from "feed";

import { parse as bbParse } from './bbcode.js';
import type { GetAppList, GetNewsForApp } from "./types.js";

export function generateRssFeed(rssitems: RssItem[]) {
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
        language: "en",
        feedLinks: {
            rss: 'https://uwx.github.io/steam-news/steam_news.xml',
            json: 'https://uwx.github.io/steam-news/steam_news.json',
            atom: 'https://uwx.github.io/steam-news/steam_news.atom',
        },
    }); // TODO should ttl get a value?

    for (const item of rssitems) {
        feed.addItem(item);
    }

    return feed;
}

const FEEDTYPE_HTML = 0;
const FEEDTYPE_BBCODE = 1;

export function newsItemToRssItem(newsitem: GetNewsForApp.NewsItem, appids: string[], applist: Record<string, GetAppList.App>) {
    let content: string;

    if (newsitem.feed_type === FEEDTYPE_BBCODE)
        content = convertBBCodeToHTML(newsitem.contents!);
    else
        content = newsitem.contents!;

    let rsstitle = newsitem.title;
    if (appids.length > 1)
        rsstitle = `[Multiple] ${rsstitle}`;
    else if (!rsstitle.includes(applist[appids[0]].name))
        rsstitle = `[${applist[appids[0]].name}] ${rsstitle}`
    // else
    // game title is in article title, do nothing

    let source = newsitem.feedlabel
    if (!source) {
        //patch over missing feedname in Steam News;
        // seems to be the only news source w/o feedlabels?
        if (newsitem.feedname === 'steam_community_blog')
            source = 'Steam Community Blog'
        else
            //shrug.
            source = newsitem.feedname || 'Unknown Source'
    }

    const sources = `<p><i>Via <b>${source}</b> for ${
        appids.map(appid => `<a href="https://store.steampowered.com/app/${appid}/">${applist[appid].name}</a>`).join(', ')
    }</i></p>\n`;

    return {
        title: rsstitle,
        link: newsitem.url!,
        description: sources + content,
        content: sources + content,
        author: newsitem.author ? [{ name: newsitem.author }] : undefined,
        id: newsitem.gid,
        date: new Date(newsitem.date*1000),
        published: new Date(newsitem.date*1000),
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
const IMG_REPLACEMENTS: Record<string, string> = {
    '{STEAM_CLAN_IMAGE}': 'https://clan.akamai.steamstatic.com/images/',
    '{STEAM_CLAN_LOC_IMAGE}': 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/clans',
};
