#!/usr/bin/env python3

import logging
from datetime import datetime, timezone
import difflib
from functools import partial
from typing import cast

import PyRSS2Gen as rss
import bbcode
from SteamNewsTypes import NewsItem

from database import NewsDatabase

# Generate RSS, see:
# https://cyber.harvard.edu/rss/rss.html
# https://docs.python.org/3.5/library/datetime.html
# https://pypi.python.org/pypi/PyRSS2Gen
# http://dalkescientific.com/Python/PyRSS2Gen.html

logger = logging.getLogger(__name__)

def genRSSFeed(rssitems: list[rss.RSSItem]):
    pdate = datetime.now(timezone.utc)
    lbdate = max(cast(datetime, x.pubDate) for x in rssitems)
    return rss.RSS2(
        title='Steam Game News',
        link='http://store.steampowered.com/news/?feed=mygames',
        description='All of your Steam games\' news, combined!',
        pubDate=pdate,
        lastBuildDate=lbdate,
        items=rssitems,
        ttl=60*24,
    )  # TODO should ttl get a value?

FEEDTYPE_HTML = 0
FEEDTYPE_BBCODE = 1

def rowToRSSItem(row: NewsItem, db: NewsDatabase):
    if row['feed_type'] == FEEDTYPE_BBCODE:
        content = convertBBCodeToHTML(row['contents'])
    else:
        content = row['contents']

    #Add the title of the game to the article title,
    #  but only if not present according to 'in' or difflib.get_close_matches.
    #get_close_matches isn't great for longer titles given the split() but /shrug
    #There are other libraries for fuzzy matching but difflib is built in...
    games = db.get_source_names_for_item(row['gid']) or ['Unknown?']
    rsstitle = row['title']
    if len(games) > 1:
        rsstitle = f'[Multiple] {rsstitle}'
    elif games[0] not in rsstitle:
        rsstitle = f'[{games[0]}] {rsstitle}'
    #else game title is in article title, do nothing

    source = row['feedlabel']
    if not source:
        #patch over missing feedname in Steam News;
        # seems to be the only news source w/o feedlabels?
        if row['feedname'] == 'steam_community_blog':
            source = 'Steam Community Blog'
        else:
            #shrug.
            source = row['feedname'] or 'Unknown Source'
    
    sources = f'<p><i>Via <b>{source}</b> for {", ".join(games)}</i></p>\n'

    return rss.RSSItem(
        title=rsstitle,
        link=row['url'],
        description=sources + content,
        author=row['author'],
        guid=rss.Guid(row['gid'], isPermaLink=False),
        pubDate=datetime.fromtimestamp(row['date'], timezone.utc),
        categories=[
            source
        ],
        source=len(games) == 1 and rss.Source(games[0], f'https://store.steampowered.com/app/{row["appid"]}/') or None
    )  # omitted: categories, comments, enclosure, source

# RE: BBCode http://bbcode.readthedocs.org/
# note: feed_type is 1 for steam community announcements
#  (feedname usually == 'steam_community_announcements') and 0 otherwise
# this seems to be connected to the use of Steam's bbcode
# see https://steamcommunity.com/comment/Recommendation/formattinghelp

# Builtins: b, i, u, s, hr, sub, sup, list/*, quote (no author), code, center, color, url
# Steam: h1, h2, h3, b, u, i, strike, spoiler, noparse, url, list/*, olist/*, quote=author, code, table[tr[th, td]], previewyoutube
# More from Steam not in above url: img
# Adding: h1, h2, h3, strike, spoiler, noparse, olist (* already covered), table, tr, th, td, previewyoutube
# Ignoring special quote


# Spoiler CSS
'''
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
'''


def convertBBCodeToHTML(text: str):
    bb = bbcode.Parser()

    for tag in ('strike', 'table', 'tr', 'th', 'td', 'h1', 'h2', 'h3'):
        bb.add_simple_formatter(tag, f'<{tag}>%(value)s</{tag}>')

    #bb.add_simple_formatter('img', '<img style="display: inline-block; max-width: 100%%;" src="%(value)s"></img>', strip=True, replace_links=False)
    bb.add_formatter('img', render_img, strip=True, replace_links=False)

    bb.add_formatter('previewyoutube', render_yt,
                     strip=True, replace_links=True)

    # The extra settings here are roughly based on the default formatters seen in the bbcode module source
    bb.add_simple_formatter(
        'noparse', '%(value)s', render_embedded=False, replace_cosmetic=False)  # see 'code'
    bb.add_simple_formatter('olist', '<ol>%(value)s</ol>', transform_newlines=False,
                            strip=True, swallow_trailing_newline=True)  # see 'list'
    bb.add_simple_formatter('spoiler',
            '<span style="color: #000000;background-color: #000000;padding: 0px 8px;">%(value)s</span>')  # see bbcode 's' & above css

    return bb.format(text)

# Community img tags frequently look like
# [img]{STEAM_CLAN_IMAGE}/27357479/d1048c635a5672f8efea79138bfd105b3cae552e.jpg[/img]
# which should translate to <img src="https://steamcdn-a.akamaihd.net/steamcommunity/public/images/clans/27357479/d1048c635a5672f8efea79138bfd105b3cae552e.jpg">
# e.g. {STEAM_CLAN_IMAGE} -> https://steamcdn-a.akamaihd.net/steamcommunity/public/images/clans
# Steam News (official blog) has a newer tag type
# {STEAM_CLAN_LOC_IMAGE}/27766192/45e4984a51cabcc390f9e1c1d2345da97f744851.gif becomes...
# https://cdn.akamai.steamstatic.com/steamcommunity/public/images/clans/27766192/45e4984a51cabcc390f9e1c1d2345da97f744851.gif

#sort of makes me wonder if these are interchangable...
IMG_REPLACEMENTS = {
    '{STEAM_CLAN_IMAGE}': 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/clans',
    '{STEAM_CLAN_LOC_IMAGE}': 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/clans',
}

def render_img(tag_name: str, value: str, options, parent, context):
    src = value
    for find, replace in IMG_REPLACEMENTS.items():
        src = src.replace(find, replace)
    return f'<img style="display: inline-block; max-width: 100%;" src="{src}"></img>'

def render_yt(tag_name, value, options, parent, context):
    # Youtube links in Steam posts look like
    # [previewyoutube=gJEgjiorUPo;full][/previewyoutube]
    # We *could* transform them into youtube embeds but
    # I'd rather have the choice to click on them, so just make them youtu.be links
    try:
        # grab everything between the '=' (options dict) and the ';'
        # TODO is there always a ;full component?
        yt_id = options['previewyoutube'][:options['previewyoutube'].index(';')]
        return '<a rel="nofollow" href="https://youtu.be/{0}">https://youtu.be/{0}</a>'.format(yt_id)
    except (KeyError, ValueError):
        # TODO uhh... look at https://dcwatson.github.io/bbcode/formatters/ again
        return ''

def publish(db: NewsDatabase, output_path=None):
    if not output_path:
        output_path = 'steam_news.xml'

    logger.info('Generating RSS feed...')
    rssitems = [rowToRSSItem(row, db) for row in db.get_news_rows()]
    feed = genRSSFeed(rssitems)
    logger.info('Writing to %s...', output_path)
    with open(output_path, 'w') as f:
        feed.write_xml(f, 'utf-8')
    logger.info('Published!')

if __name__ == '__main__':
    import sys
    logging.basicConfig(stream=sys.stdout,
            format='%(asctime)s | %(name)s | %(levelname)s | %(message)s',
            level=logging.DEBUG)
    with NewsDatabase('SteamNews.db') as db:
        publish(db)
