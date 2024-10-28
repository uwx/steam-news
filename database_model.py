from peewee import SqliteDatabase, Model, CharField, ForeignKeyField, TextField, DateTimeField, BooleanField,AutoField, IntegerField, SQL, CompositeKey
import datetime

database: SqliteDatabase | None = None

class UnknownField(object):
    def __init__(self, *_, **__): pass

class BaseModel(Model):
    class Meta:
        @property
        def database(self):
            return database

class Game(BaseModel):
    appid = AutoField(null=True)
    name = TextField()
    should_fetch = IntegerField(column_name='shouldFetch', constraints=[SQL("DEFAULT 1")])

    class Meta:
        table_name = 'Games'

class ExpireTime(BaseModel):
    appid = ForeignKeyField(column_name='appid', field='appid', model=Game, null=True, primary_key=True)
    unixseconds = IntegerField(constraints=[SQL("DEFAULT 0")])

    class Meta:
        table_name = 'ExpireTimes'

class NewsItem(BaseModel):
    appid = IntegerField()
    author = TextField(null=True)
    contents = TextField(null=True)
    date = IntegerField(constraints=[SQL("DEFAULT strftime('%s')")], index=True)
    feed_type = IntegerField(null=True)
    feedlabel = TextField(null=True)
    feedname = TextField(null=True)
    gid = TextField(primary_key=True)
    is_external_url = IntegerField(null=True)
    title = TextField()
    url = TextField(null=True)

    class Meta:
        table_name = 'NewsItems'

class NewsSource(BaseModel):
    appid = ForeignKeyField(column_name='appid', field='appid', model=Game)
    gid = ForeignKeyField(column_name='gid', field='gid', model=NewsItem)

    class Meta:
        table_name = 'NewsSources'
        indexes = (
            (('gid', 'appid'), True),
        )
        primary_key = CompositeKey('appid', 'gid')

def open(path: str):
    database = SqliteDatabase(path)
    return database