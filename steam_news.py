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
import os
import subprocess
import sys
import time
from typing import Optional, TypedDict, cast
import requests
from urllib.error import HTTPError
from xml.dom.minicompat import NodeList
from xml.dom import minidom
from xml.dom.minidom import Document, Element, Node, Text
from dotenv import load_dotenv
import typed_argparse as tap

load_dotenv()

from steam_news_types import News, NewsError, NewsItem
from database import NewsDatabase
from news_publisher import publish

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


def seed_database(id_or_vanity: str, db: NewsDatabase):
    sid = int(id_or_vanity)
    # https://steamcommunity.com/dev/apikey
    url = f'http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key={os.environ["STEAM_WEB_API_KEY"]}&steamid={sid}&format=json'

    newsids, last_played = get_app_ids_from_url(url)

    #Also add the hardcoded ones...
    newsids.update(STEAM_APPIDS)
    db.add_games(newsids)

    # set should_fetch to whether last played <6mo ago
    logger.info(last_played)
    six_months_ago = (datetime.now(timezone.utc) - timedelta(days=6 * 30))
    db.set_fetching_ids(
        (appid, last_played_datetime >= six_months_ago) for appid, last_played_datetime in last_played.items()
    )

applist: dict[int, str] | None = None

class GetAppListResult(TypedDict):
    applist: 'GetAppListResult_Applist'

class GetAppListResult_Applist(TypedDict):
    apps: list['GetAppListResult_App']

class GetAppListResult_App(TypedDict):
    appid: int
    name: str

class GetOwnedGamesResult(TypedDict):
    response: 'GetOwnedGamesResult_Response'

class GetOwnedGamesResult_Response(TypedDict):
    game_count: int
    games: list['GetOwnedGamesResult_Game']

class GetOwnedGamesResult_Game(TypedDict):
    appid: int
    playtime_forever: int
    playtime_windows_forever: int
    playtime_mac_forever: int
    playtime_linux_forever: int
    playtime_deck_forever: int
    rtime_last_played: int
    playtime_disconnected: int
    playtime_2_weeks: Optional[int]


def get_app_ids_from_url(url: str):
    global applist

    """Given a steam profile url, produce a dict of
    appids to names of games owned (appids are strings)
    Note that the profile in question needs to be public for this to work!"""
    logger.info('Parsing JSON from %s...', url)

    if applist is None:
        logger.info('Downloading steam app list...')
        res = requests.get('https://api.steampowered.com/ISteamApps/GetAppList/v2/')
        res.raise_for_status()
        applist = dict[int, str]((x['appid'], x['name']) for x in cast(GetAppListResult, res.json())['applist']['apps'])

    games: dict[int, str] = {}
    last_played: dict[int, datetime] = {}

    res = requests.get(url)
    if res.ok:
        j: GetOwnedGamesResult = res.json()

    for ge in j['response']['games']:
        appid = ge['appid']
        name = applist[appid] \
            if appid in applist \
            else str(appid)
        games[appid] = name
        last_played[appid] = datetime.fromtimestamp(ge['rtime_last_played'], timezone.utc)

    logger.info('Found %d games.', len(games))
    return games, last_played

# Date/time manipulation

def get_expires_datetime_from_response(response: requests.Response):
    def parse_expires_as_datetime(exp: str):
        # e.g. 'Sun, 15 Apr 2018 17:20:14 GMT'
        t = datetime.strptime(exp, '%a, %d %b %Y %H:%M:%S %Z')
        # The %Z parsing doesn't work right since it seems to expect a +##:## code on top of the GMT
        # So we're going to assume it's always GMT/UTC
        return t.replace(tzinfo=timezone.utc)

    exp = response.headers.get('Expires', None)
    return datetime.now(timezone.utc) if exp is None else parse_expires_as_datetime(exp)

# Why are there so many variables named ned?
# I shorthanded "news element dict" to distinguish it as a single item
# vs. 'news' which is typically used for the entire JSON payload Steam gives us

def get_news_for_appid(appid: int, filter_feed_names: str | None) -> News | NewsError:
    """Get news for the given appid as a dict"""
    url = f'https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?format=json&maxlength=0&count=10&appid={appid}{filter_feed_names and f"&feeds={filter_feed_names}" or ""}'
    try:
        response = requests.get(url)
        response.raise_for_status()

        # Get value of 'expires' header as a datetime obj
        exdt = get_expires_datetime_from_response(response)
        # Parse the JSON
        news: News = response.json()
        # Add the expire time to the group as a plain unix time
        news['expires'] = int(exdt.timestamp())
        # Decorate each news item and the group with its "true" appid
        for newsitem in news['appnews']['newsitems']:
            newsitem['realappid'] = appid

        return news
    except HTTPError as e:
        return {'error': f'{e.code} {e.reason}'}

def is_news_old(ned: NewsItem):
    """Is this news item more than 30 days old?"""
    newsdt = datetime.fromtimestamp(ned['date'], timezone.utc)
    thirtyago = datetime.now(timezone.utc) - timedelta(days=30)
    return newsdt < thirtyago

def save_recent_news(news: News, db: NewsDatabase):
    """Given a single news dict from getNewsForAppID,
    save all "recent" news items to the DB"""
    db.update_expire_time(news['appnews']['appid'], news['expires'])

    current_entries = 0
    for ned in news['appnews']['newsitems']:
        if not is_news_old(ned):
            db.insert_news_item(ned)
            current_entries += 1
    return current_entries

def get_all_recent_news(newsids: dict[int, str], db: NewsDatabase, filter_feed_names: str | None):
    """Given a dict of appids to names, store all "recent" items, respecting the cache"""
    cache_hits = 0
    new_hits = 0
    fails = 0
    idx = 0
    total_current = 0
    for aid, name in newsids.items():
        idx += 1
        if not db.should_fetch(aid):
            logger.info('[%d/%d] Skipped %d: shouldFetch is False', idx, len(newsids), aid)
            continue

        if db.is_news_cached(aid):
            logger.info('[%d/%d] Cache for %d: %s still valid!', idx, len(newsids), aid, name)
            cache_hits += 1
            continue

        news = get_news_for_appid(aid, filter_feed_names)
        if 'appnews' in news: # success
            cur_entries = save_recent_news(cast(News, news), db)
            new_hits += 1
            if cur_entries:
                logger.info('[%d/%d] Fetched %d: %s OK; %d current items', idx, len(newsids), aid, name, cur_entries)
                total_current += cur_entries
            else:
                logger.info('[%d/%d] Fetched %d: %s OK; nothing current', idx, len(newsids), aid, name)
            time.sleep(0.25)
        else:
            fails += 1
            logger.error('[%d/%d] %d: %s fetch error: %s', idx, len(newsids), aid, name, news['error'])
            time.sleep(1)

    logger.info('Run complete. %d cached, %d fetched, %d failed; %d current news items', cache_hits, new_hits, fails, total_current)

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

class Args(tap.TypedArgs):
    first_run: bool = tap.arg('--first-run')
    add_profile_games: Optional[str] = tap.arg('-a', '--add-profile-games', metavar='Steam ID|Vanity url')
    fetch: bool = tap.arg('-f', '--fetch')
    publish: Optional[str] = tap.arg('-p', '--publish', metavar='XML output path')
    edit_games_like: Optional[str] = tap.arg('-g', '--edit-games-like', metavar='partial name of game')
    verbose: bool = tap.arg('-v', '--verbose')
    db_path: str = tap.arg('--db-path', default='SteamNews.db')
    filter_feed_names: Optional[str] = tap.arg('--filter-feed-names')

def main(args: Args):
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
                get_all_recent_news(newsids, db, args.filter_feed_names)

            if args.publish:
                publish(db, args.publish)

if __name__ == '__main__':
    tap.Parser(Args).bind(main).run()
