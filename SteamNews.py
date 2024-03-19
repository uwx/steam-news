#!/usr/bin/env python3

# Inspired by the likes of
# https://bendodson.com/weblog/2016/05/17/fetching-rss-feeds-for-steam-game-updates/
# http://www.getoffmalawn.com/blog/rss-feeds-for-steam-games

import argparse
from datetime import datetime, timezone, timedelta
from enum import Enum
from http.client import HTTPResponse
import json
import logging
from os import path
import subprocess
import sys
import time
from typing import cast
from urllib.request import urlopen
from urllib.error import HTTPError
from xml.dom.minicompat import NodeList
from xml.dom import minidom
from xml.dom.minidom import Document, Element, Node, Text
from SteamNewsTypes import News, NewsError, NewsItem

from database import NewsDatabase
from NewsPublisher import publish

logger = logging.getLogger(__name__)

# Hardcoded list of AppIDs that return news related to Steam as a whole (not games)
# Mileage may vary. Use app_id_discovery.py to maybe find more of these...
STEAM_APPIDS = {
    753: 'Steam',
    221410: 'Steam for Linux',
    223300: 'Steam Hardware',
    250820: 'SteamVR',
    353370: 'Steam Controller',
    353380: 'Steam Link',
    358720: 'SteamVR Developer Hardware',
    596420: 'Steam Audio',
    #593110 is the source for the megaphone icon in the client, not in appid list...
    593110: 'Steam News',
    613220: 'Steam 360 Video Player'
}


def seed_database(idOrVanity: str, db: NewsDatabase):
    sid = int(idOrVanity)
    url = f'http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=7FC6975AC56F6E142E40E7623F4BCBB1&steamid={sid}&format=json'

    newsids = getAppIDsFromURL(url)
    #Also add the hardcoded ones...
    newsids.update(STEAM_APPIDS)
    db.add_games(newsids)

applist: dict[int, str] | None = None

def getAppIDsFromURL(url: str):
    global applist

    """Given a steam profile url, produce a dict of
    appids to names of games owned (appids are strings)
    Note that the profile in question needs to be public for this to work!"""
    logger.info('Parsing JSON from %s...', url)

    with urlopen(url) as f:
        j = json.load(f)

    if applist is None:
        logger.info('Downloading steam app list...')
        with urlopen('https://api.steampowered.com/ISteamApps/GetAppList/v2/') as f:
            applist = dict[int, str]((x['appid'], x['name']) for x in json.load(f)['apps'])

    games: dict[int, str] = {}
    for ge in j['response']['games']:
        appid = ge['appid']
        name = applist[appid] if appid in applist else str(appid)
        games[appid] = name

    logger.info('Found %d games.', len(games))
    return games

# Date/time manipulation

def getExpiresDTFromResponse(response: HTTPResponse):
    exp = response.getheader('Expires')
    return datetime.now(timezone.utc) if exp is None else parseExpiresAsDT(exp)


def parseExpiresAsDT(exp: str):
    # e.g. 'Sun, 15 Apr 2018 17:20:14 GMT'
    t = datetime.strptime(exp, '%a, %d %b %Y %H:%M:%S %Z')
    # The %Z parsing doesn't work right since it seems to expect a +##:## code on top of the GMT
    # So we're going to assume it's always GMT/UTC
    return t.replace(tzinfo=timezone.utc)

# Why are there so many variables named ned?
# I shorthanded "news element dict" to distinguish it as a single item
# vs. 'news' which is typically used for the entire JSON payload Steam gives us

def getNewsForAppID(appid: int, filter_feed_names: str | None) -> News | NewsError:
    """Get news for the given appid as a dict"""
    url = f'https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?format=json&maxlength=0&count=10&appid={appid}{filter_feed_names and f"&feeds={filter_feed_names}" or ""}'
    try:
        response: HTTPResponse = urlopen(url)
        # Get value of 'expires' header as a datetime obj
        exdt = getExpiresDTFromResponse(response)
        # Parse the JSON
        news: News = json.loads(response.read().decode('utf-8'))
        # Add the expire time to the group as a plain unix time
        news['expires'] = int(exdt.timestamp())
        # Decorate each news item and the group with its "true" appid
        for ned in news['appnews']['newsitems']:
            ned['realappid'] = appid

        return news
    except HTTPError as e:
        return {'error': f'{e.code} {e.reason}'}


def isNewsOld(ned: NewsItem):
    """Is this news item more than 30 days old?"""
    newsdt = datetime.fromtimestamp(ned['date'], timezone.utc)
    thirtyago = datetime.now(timezone.utc) - timedelta(days=30)
    return newsdt < thirtyago


def saveRecentNews(news: News, db: NewsDatabase):
    """Given a single news dict from getNewsForAppID,
    save all "recent" news items to the DB"""
    db.update_expire_time(news['appnews']['appid'], news['expires'])

    current_entries = 0
    for ned in news['appnews']['newsitems']:
        if not isNewsOld(ned):
            db.insert_news_item(ned)
            current_entries += 1
    return current_entries


def getAllRecentNews(newsids: dict[int, str], db: NewsDatabase, filter_feed_names: str | None):
    """Given a dict of appids to names, store all "recent" items, respecting the cache"""
    cachehits = 0
    newhits = 0
    fails = 0
    idx = 0
    for aid, name in newsids.items():
        idx += 1
        if db.is_news_cached(aid):
            logger.info('[%d/%d] Cache for %d: %s still valid!', idx, len(newsids), aid, name)
            cachehits += 1
            continue

        news = getNewsForAppID(aid, filter_feed_names)
        if 'appnews' in news: # success
            cur_entries = saveRecentNews(cast(News, news), db)
            newhits += 1
            if cur_entries:
                logger.info('[%d/%d] Fetched %d: %s OK; %d current items', idx, len(newsids), aid, name, cur_entries)
            else:
                logger.info('[%d/%d] Fetched %d: %s OK; nothing current', idx, len(newsids), aid, name)
            time.sleep(0.25)
        else:
            fails += 1
            logger.error('[%d/%d] %d: %s fetch error: %s', idx, len(newsids), aid, name, news['error'])
            time.sleep(1)

    logger.info('Run complete. %d cached, %d fetched, %d failed',
            cachehits, newhits, fails)

def edit_fetch_games(name: str, db: NewsDatabase):
    logger.info('Editing games like "%s"', name)
    games = db.get_games_like(name)
    before_on = set[int]()
    before_off = set[int]()
    args = [
        'whiptail', '--title', 'Select games to fetch news for',
        '--separate-output', '--checklist',
        'Use arrow keys to move, Space to toggle, Tab to go to OK, ESC to cancel.',
        '50', '100', '43', '--'
    ]
    for game in games:
        if game['shouldFetch']:
            before_on.add(game['appid'])
            status = 'on'
        else:
            before_off.add(game['appid'])
            status = 'off'
        args.append(str(game['appid']))
        args.append(game['name'])
        args.append(status)

    proc = subprocess.run(args, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        logger.info('Cancelled editing games.')
        return
    #Convert stderr output to set of int appids...
    out = proc.stderr.strip() #mainly to remove trailing newline
    selected = frozenset(int(x) for x in out.split('\n'))
    logger.debug('Before on: %s\nBefore off: %s\nSelected (enable): %s', before_on, before_off, selected)
    #disable: ids in before_on that are not in selected
    disabled = before_on - selected
    #enable: ids in selected that are also in before_off
    enabled = selected & before_off
    logger.debug('Enabled %s\nDisabled: %s', enabled, disabled)

    if disabled:
        db.disable_fetching_ids(disabled)
        logger.info('Disabled %d games.', len(disabled))
    if enabled:
        db.enable_fetching_ids(enabled)
        logger.info('Enabled %d games.', len(enabled))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--first-run', action='store_true')
    parser.add_argument('-a', '--add-profile-games') # + steam ID/vanity url
    parser.add_argument('-f', '--fetch', action='store_true')
    parser.add_argument('-p', '--publish') # + path to XML output
    parser.add_argument('-g', '--edit-games-like') # + partial name of game
    parser.add_argument('-v', '--verbose', action='store_true')
    parser.add_argument('--db-path', default='SteamNews.db')
    parser.add_argument('--filter-feed-names')
    args = parser.parse_args()

    lvl = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        stream=sys.stdout,
        format='%(asctime)s | %(name)s | %(levelname)s | %(message)s',
        level=lvl
    )

    db_uninitialized = not path.exists(args.db_path)
    with NewsDatabase(args.db_path) as db:
        if args.first_run or db_uninitialized:
            db.first_run()

        if args.add_profile_games:
            seed_database(args.add_profile_games, db)

        if args.edit_games_like:
            edit_fetch_games(args.edit_games_like, db)
        else: #editing is mutually exclusive w/ fetch & publish
            if args.fetch:
                newsids = db.get_fetch_games()
                getAllRecentNews(newsids, db, args.filter_feed_names)

            if args.publish:
                publish(db, args.publish)

if __name__ == '__main__':
    main()
