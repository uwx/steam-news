/**
 * This file was generated by kysely-codegen.
 * Please do not edit it manually.
 */

import type { ColumnType, Insertable, InsertObject, Selectable } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;

export interface ExpireTime {
    appid: number | null;
    unixseconds: Generated<number>;
}

export interface Game {
    appid: number;
    name: string;
    shouldFetch: Generated<number>;
}

export interface NewsItem {
    appid: number;
    author: string | null;
    contents: string | null;
    date: Generated<number>;
    feed_type: number | null;
    feedlabel: string | null;
    feedname: string | null;
    gid: string;
    is_external_url: number | null;
    title: string;
    url: string | null;
}

export interface NewsSource {
    appid: number;
    gid: string;
}

export interface Database {
    ExpireTimes: ExpireTime;
    Games: Game;
    NewsItems: NewsItem;
    NewsSources: NewsSource;
}

import SQLite from 'better-sqlite3';
import { Kysely, Migrator, sql, SqliteDialect } from 'kysely';
import type { AppNewsItem } from "./index.js";

async function openDb(path: string) {
    const dialect = new SqliteDialect({
        database: new SQLite(path),
    });

    const db = new Kysely<Database>({
        dialect,
    });

    // const migrationFolder = new URL('./migrations', import.meta.url).pathname

    const migrator = new Migrator({
        db,
        provider: {
            async getMigrations() {
                return {
                    '1_start': await import('./migrations/1_start.js')
                };
            },
        }
    })
    console.log(await migrator.migrateToLatest());

    return db;
}

export class NewsDatabase {
    private db?: Kysely<Database>;
    constructor(private path: string) {}

    async open() {
        if (!this.db) {
            console.log(`Opening DB @ ${this.path}`);
            this.db = await openDb(this.path);
            // await sql`'PRAGMA foreign_keys = ON'`.execute(this.db);
        }
    }

    async close(optimize = true) {
        if (this.db) {
            if (optimize) {
                console.log('Optimizing DB before close...');
                await sql`PRAGMA optimize`.execute(this.db);
            }
            console.log(`Closing DB @ ${this.path}`);
            this.db.destroy();
            this.db = undefined;
        }
    }

    async [Symbol.asyncDispose]() {
        await this.close();
    }

    // Given a dict of appid: name, populate them in the database.
    async addGames(games: Record<number, string>) {
        if (!this.db) throw new Error('DB not initialized');

        const result = await this.db
            .insertInto('Games')
                .values(
                Object.entries(games).map(([appid, name]) => ({
                    appid: Number(appid),
                    name
                }))
            )
            .onConflict(oc => oc
                .column('appid')
                .doUpdateSet(eb => ({
                    name: eb.ref('excluded.name')
                }))
            )
            .executeTakeFirstOrThrow();

        console.log(`Added ${result.numInsertedOrUpdatedRows} new games to be fetched.`);
    }

    async removeGamesNotInList(appids: (string | number)[]) {
        if (!this.db) throw new Error('DB not initialized');

        const result = await this.db
            .deleteFrom('Games')
            .where('appid', 'not in', appids.map(e => Number(e)))
            .executeTakeFirstOrThrow();

        console.log(`Removed ${result.numDeletedRows} games no longer owned by the user.`);
    }

    async getGamesLike(name: string) {
        if (!this.db) throw new Error('DB not initialized');

        name = name.trim().replace(/%/g, '')

        if (name) {
            return await this.db
                .selectFrom('Games')
                .where('name', 'like', `%${name}%`)
                .orderBy('name')
                .selectAll()
                .execute();
        } else {
            return await this.db
                .selectFrom('Games')
                .orderBy('name')
                .selectAll()
                .execute();
        }
    }

    async setFetchingIds(appidsAndShouldFetch: [appid: number, shouldFetch: boolean][]) {
        if (!this.db) throw new Error('DB not initialized');

        let rc = 0n;

        let res = await this.db
            .updateTable('Games')
            .set('shouldFetch', 1)
            .where('appid', 'in', appidsAndShouldFetch.filter(([appid, shouldFetch]) => shouldFetch).map(([appid, shouldFetch]) => appid))
            .executeTakeFirstOrThrow();

        rc += res.numChangedRows ?? res.numUpdatedRows;

        res = await this.db
            .updateTable('Games')
            .set('shouldFetch', 0)
            .where('appid', 'in', appidsAndShouldFetch.filter(([appid, shouldFetch]) => !shouldFetch).map(([appid, shouldFetch]) => appid))
            .executeTakeFirstOrThrow();

        rc += res.numChangedRows ?? res.numUpdatedRows;

        console.log(`Set shouldFetch for ${rc} games.`)
    }

    async canFetchGames(appids: (string | number)[]) {
        if (!this.db) throw new Error('DB not initialized');

        const a = this.db
            .selectFrom('Games')
            .where('appid', 'in', appids.map(e => Number(e)))
            .where('shouldFetch', '!=', 0)
            .select(['appid']);

        // console.log(a.compile());

        return (await a
            .execute()).length == appids.length;
    }

    async getFetchGames() {
        if (!this.db) throw new Error('DB not initialized');

        return Object.fromEntries(
            (await this.db
                .selectFrom('Games')
                .where('shouldFetch', '!=', 0)
                .select(['appid', 'name'])
                .execute())
                .map(e => [e.appid, e.name])
        );
    }

    async updateExpireTime(appid: number, expires: number) {
        if (!this.db) throw new Error('DB not initialized');

        await this.db
            .insertInto('ExpireTimes')
            .values({
                appid,
                unixseconds: expires
            })
            .onConflict(oc => oc
                .column('appid')
                .doUpdateSet({ unixseconds: expires })
            )
            .execute();
    }

    async isNewsCached(appid: number) {
        if (!this.db) throw new Error('DB not initialized');

        const exptime = await this.db
            .selectFrom('ExpireTimes')
            .where('appid', '=', appid)
            .select('unixseconds')
            .executeTakeFirst();

        // TODO maybe use datetime.timestamp() & now() instead?
        return exptime !== undefined && (Date.now() / 1000) < exptime.unixseconds;
    }

    async insertNewsItem(ned: AppNewsItem) {
        if (!this.db) throw new Error('DB not initialized');

        await this.db
            .insertInto('NewsItems')
            .values({
                appid: ned.appid,
                author: ned.author,
                contents: ned.contents,
                date: ned.date,
                feed_type: ned.feed_type,
                feedlabel: ned.feedlabel,
                feedname: ned.feedname,
                gid: ned.gid,
                is_external_url: ned.is_external_url ? 1 : 0,
                title: ned.title,
                url: ned.url,
            })
            .onConflict(oc => oc.doNothing())
            .execute();

        await this.db
            .insertInto('NewsSources')
            .values({ appid: ned.realappid, gid: ned.gid })
            .onConflict(oc => oc.doNothing())
            .execute();
    }

    async getNewsRows(): Promise<Selectable<NewsItem>[]> {
        if (!this.db) throw new Error('DB not initialized');

        return await this.db
            .selectFrom('NewsItems')
            .where('date', '>=', sql<number>`strftime('%s', 'now', '-30 day')`)
            .orderBy('date desc')
            .selectAll()
            .execute();
    }

    async getSourceNamesAndAppIdForItem(gid: string): Promise<{ appid: number; name: string; }[]> {
        if (!this.db) throw new Error('DB not initialized');

        return await this.db
            .selectFrom('NewsSources')
            .where('gid', '=', gid)
            .rightJoin('Games', 'Games.appid', 'NewsSources.appid')
            .orderBy('Games.appid')
            .select(['Games.name', 'Games.appid'])
            .execute();
    }
}