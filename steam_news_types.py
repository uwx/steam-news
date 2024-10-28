from typing import TypedDict

class NewsItem(TypedDict):
    gid: str
    title: str
    url: str
    is_external_url: bool
    author: str
    contents: str
    feedlabel: str
    date: int
    feedname: str
    feed_type: int # 0=HTML, 1=BBCODE
    appid: int
    tags: list[str]
    realappid: int

class AppNews(TypedDict):
    appid: int
    newsitems: list[NewsItem]

class News(TypedDict):
    appnews: AppNews
    expires: int

class NewsError(TypedDict):
    error: str
