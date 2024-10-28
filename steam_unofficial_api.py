from enum import Enum
from itertools import groupby
from typing import Any, Generator, Mapping, Protocol, Sequence, TypeVar, TypedDict
from typing_extensions import ReadOnly
from yarl import URL
import requests
from datetime import datetime, timezone

class URLs:
    API = URL("https://api.steampowered.com")
    COMMUNITY = URL("https://steamcommunity.com")
    STORE = URL("https://store.steampowered.com")
    HELP = URL("https://help.steampowered.com")
    LOGIN = URL("https://login.steampowered.com")
    CDN = URL("https://cdn.cloudflare.steamstatic.com")
    PUBLISHER_API = URL("https://partner.steam-api.com")

number = int
string = str
boolean = bool

class HasSuccess(TypedDict):
    success: number

class ClanEvents(TypedDict):
    success: number
    events: list['ClanEvent']

class ClanEvent(TypedDict):
    gid: string
    clan_steamid: string
    event_name: string
    event_type: number
    appid: number
    server_address: string
    server_password: string
    rtime32_start_time: number
    rtime32_end_time: number
    comment_count: number
    creator_steamid: string
    last_update_steamid: string
    event_notes: string
    jsondata: string
    announcement_body: 'AnnouncementBody'
    published: number
    hidden: number
    rtime32_visibility_start: number
    rtime32_visibility_end: number
    broadcaster_accountid: number
    follower_count: number
    ignore_count: number
    forum_topic_id: string
    rtime32_last_modified: number
    news_post_gid: string
    rtime_mod_reviewed: number
    featured_app_tagid: number
    referenced_appids: list[Any]
    build_id: number
    build_branch: string
    votes_up: number
    votes_down: number
    comment_type: string
    gidfeature: string
    gidfeature2: string
    clan_steamid_original: string

class AnnouncementBody(TypedDict):
    gid: string
    clanid: string
    posterid: string
    headline: string
    posttime: number
    updatetime: number
    body: string
    commentcount: number
    tags: list[string]
    language: number
    hidden: number
    forum_topic_id: string
    event_gid: string
    voteupcount: number
    votedowncount: number

class VanityAndClanId(TypedDict):
    success: number
    appid: number
    clanAccountID: number
    clanSteamIDString: string
    member_count: number
    vanity_url: string
    is_ogg: boolean
    is_creator_home: number
    is_curator: boolean
    has_visible_store_page: boolean
    avatar_full_url: string
    group_name: string

class AppType(Enum):
    Recent = "recent" # (recently played, deletes k_ELibrary)
    Library = "library"
    Wishlist = "wishlist"
    Following = "following"
    Recommended = "recommended"
    Steam = "steam"
    Featured = "featured"
    Curator = "curator"

class EventTypes(Enum):
    news = [ 28 ]
    events = [ 9, 27, 22, 23, 24, 35, 25, 26 ]
    streaming = [ 11 ]
    updates = [ 12, 13, 14 ]
    releases = [ 10, 29, 16, 15, 32 ]
    sales = [ 20, 21, 31, 34 ]

    @staticmethod
    def type_from_int(event_type: int):
        if event_type in EventTypes.news.value: return EventTypes.news
        if event_type in EventTypes.events.value: return EventTypes.events
        if event_type in EventTypes.streaming.value: return EventTypes.streaming
        if event_type in EventTypes.updates.value: return EventTypes.updates
        if event_type in EventTypes.releases.value: return EventTypes.releases
        if event_type in EventTypes.sales.value: return EventTypes.sales

class UserEventCalendarRange(TypedDict):
    success: number
    backwardComplete: boolean | None
    forwardComplete: boolean | None
    documents: list['UserEventCalendarRangeDocument']
    apps: list['UserEventCalendarRangeApp']
    clans: list['UserEventCalendarRangeClan']
    events: list['ClanEvent']
    metadatainfo: 'UserEventCalendarRangeMetadataInfo'
    event_votes: list[Any]
    events_read: list[str]

class UserEventCalendarRangeMetadataInfo(TypedDict):
    clanid: number
    clan_event_gid: string

class UserEventCalendarRangeDocument(TypedDict):
    clanid: number
    unique_id: string
    event_type: number
    appid: number
    start_time: number
    score: number

class UserEventCalendarRangeApp(TypedDict):
    source: number
    appid: number

class UserEventCalendarRangeClan(TypedDict):
    source: number
    clanid: number

T = TypeVar('T')
def chunks(lst: list[T], n: number):
    """Yield successive n-sized chunks from lst."""
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

class SteamUnofficialApi:
    def __init__(self, headers: Mapping[str, str | bytes | None] = {}):
        self.headers = headers

    def get(self, url: URL | str, params: Mapping[str, str | bytes | None] | None = None):
        response = requests.get(
            str(url) if isinstance(url, URL) else url,
            {k: v for k, v in params.items() if v is not None and len(v) > 0} if params else None,
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

    def check_success(self, data: HasSuccess):
        if data['success'] != 1:
            raise ValueError(f'Not success: {data["success"]}')

    def get_event_details(self, clan_id_to_events_dict: dict[int, list[int]] | list[tuple[int, list[int]]], lang_list: list[int] = [0]):
        ls = [
            (clan_id, unique_id)
                for clan_id, events in (clan_id_to_events_dict.items() if isinstance(clan_id_to_events_dict, dict) else clan_id_to_events_dict)
                for unique_id in events
        ]

        params = {
            "clanid_list": ",".join(str(x[0]) for x in ls),
            "uniqueid_list": ",".join(str(x[1]) for x in ls),
            "lang_list": ",".join(str(x) for x in lang_list)
        }
        data: ClanEvents = self.get(
            URLs.STORE / "events/ajaxgeteventdetails/", params=params
        )
        self.check_success(data)
        return data["events"]

    def get_vanity_and_clan_id(self, appid: int):
        data: VanityAndClanId = self.get(URLs.COMMUNITY / 'ogg' / str(appid) / 'ajaxgetvanityandclanid/')
        self.check_success(data)
        return data

    def get_user_event_calendar_range(
        self,
        minTime: datetime = datetime.fromtimestamp(0, timezone.utc),
        maxTime: datetime = datetime.fromtimestamp(0, timezone.utc),
        ascending: bool = False,
        maxResults: int = 500, # max 1000
        populateEvents: int = 15, # max 30
        appTypes: list[AppType] = [],
        eventTypes: list[EventTypes] = [],
        collectionID: int | None = None,
        saleID: int | None = None,
        hubtype: Any | None = None,
        category_or_language: Any | None = None,
        tag_name: Any | None = None,
        tags: list[Any] = [],
        appIdFilter: list[int] = [],
        clanIdFilter: list[int] = [],
    ):
        params = {
            "minTime": str(int(minTime.timestamp())),
            "maxTime": str(int(maxTime.timestamp())),
            "ascending": str(ascending),
            "maxResults": str(maxResults),
            "populateEvents": str(populateEvents),
            "appTypes": ",".join(x.value for x in appTypes),
            "eventTypes": ",".join(str(x) for eventType in eventTypes for x in eventType.value),
            "collectionID": str(collectionID) if collectionID else '',
            "saleID": str(saleID) if saleID else '',
            "hubtype": str(hubtype) if hubtype else '',
            "category_or_language": str(category_or_language) if category_or_language else '',
            "tag_name": str(tag_name) if tag_name else '',
            "tags": ','.join(tags),
            'appIdFilter': ','.join(str(x) for x in appIdFilter),
            'clanIdFilter': ','.join(str(x) for x in clanIdFilter),
        }
        data: UserEventCalendarRange = self.get(
            URLs.STORE / "events/ajaxgetusereventcalendarrange/", params=params
        )
        self.check_success(data)
        return data

    def paginate_user_event_calendar_range_backwards(
        self,
        appTypes: list[AppType] = [],
        eventTypes: list[EventTypes] = [],
        collectionID: int | None = None,
        saleID: int | None = None,
        hubtype: Any | None = None,
        category_or_language: Any | None = None,
        tag_name: Any | None = None,
        tags: list[Any] = [],
        appIdFilter: list[int] = [],
        clanIdFilter: list[int] = [],
        limit: int | None = None,
    ):
        maxTime = datetime.now()
        count = 0
        while True:
            res = self.get_user_event_calendar_range(
                maxTime=maxTime,
                appTypes=appTypes,
                eventTypes=eventTypes,
                collectionID=collectionID,
                saleID=saleID,
                hubtype=hubtype,
                category_or_language=category_or_language,
                tag_name=tag_name,
                tags=tags,
                appIdFilter=appIdFilter,
                clanIdFilter=clanIdFilter,
            )

            count += len(res['documents'])

            maxTime = datetime.fromtimestamp(min(x['start_time'] for x in res['documents']), timezone.utc)

            yield res

            if ('backwardComplete' in res and res['backwardComplete']) or ('forwardComplete' in res and res['forwardComplete']):
                break

            if limit is not None and count >= limit:
                break

    def resolve_events(self, data: UserEventCalendarRange):
        events_dict = dict((e['gid'], e) for e in data['events'])

        unmapped_documents: list[UserEventCalendarRangeDocument] = []

        all_events: list[ClanEvent] = []

        for doc in data['documents']:
            if doc['unique_id'] in events_dict:
                all_events.append(events_dict[doc['unique_id']])

            unmapped_documents.append(doc)

        for chunk in chunks(unmapped_documents, 20):
            d = [
                (int(k), list(int(x['unique_id']) for x in v))
                    for k, v in groupby(chunk, lambda x: x['clanid'])
            ]

            events = {
                v['gid']: v
                    for v in self.get_event_details(d)
            }

            for doc in chunk:
                all_events.append(events[doc['unique_id']])
                events_dict[doc['unique_id']] = events[doc['unique_id']]

        for doc in data['documents']: # return in original order
            yield events_dict[doc['unique_id']]
