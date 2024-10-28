import { type Kysely, sql } from 'kysely'
import type { Database } from '../database.js';

export async function up(db: Kysely<Database>): Promise<void> {
    await db.schema.createTable('Games')
        .addColumn('appid', 'integer', (cb) => cb.primaryKey().notNull())
        .addColumn('name', 'text', (cb) => cb.notNull())
        .addColumn('shouldFetch', 'integer', (cb) => cb.notNull().defaultTo(1))
        .ifNotExists()
        .execute();

    await db.schema.createTable('ExpireTimes')
        .addColumn('appid', 'integer', (cb) => cb.primaryKey().references('Games.appid').onDelete('cascade').onUpdate('cascade'))
        .addColumn('unixseconds', 'integer', (cb) => cb.notNull().defaultTo(0))
        .ifNotExists()
        .execute();

    await db.schema.createTable('NewsItems')
        .addColumn('gid', 'text', cb => cb.notNull().primaryKey())
        .addColumn('title', 'text', cb => cb.notNull())
        .addColumn('url', 'text')
        .addColumn('is_external_url', 'integer')
        .addColumn('author', 'text')
        .addColumn('contents', 'text')
        .addColumn('feedlabel', 'text')
        .addColumn('date', 'integer', cb => cb.notNull().defaultTo(sql`strftime('%s')`))
        .addColumn('feedname', 'text')
        .addColumn('feed_type', 'integer')
        .addColumn('appid', 'integer', cb => cb.notNull())
        .ifNotExists()
        .execute();

    await db.schema.createTable('NewsSources')
        .addColumn('gid', 'text', cb => cb.notNull().references('NewsItems.gid').onDelete('cascade').onUpdate('cascade'))
        .addColumn('appid', 'integer', cb => cb.notNull().references('Games.appid').onDelete('cascade').onUpdate('cascade'))
        .addPrimaryKeyConstraint('NewsSources_pk', ['appid', 'gid'])
        .ifNotExists()
        .execute();

    await db.schema.createIndex('NewsDateIdx')
        .on('NewsItems')
        .column('date')
        .ifNotExists()
        .execute();

    await db.schema.createIndex('NewsSourceAppIDIdx')
        .on('NewsSources')
        .column('appid')
        .ifNotExists()
        .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
    await db.schema.dropTable('Games').execute();
    await db.schema.dropTable('ExpireTimes').execute();
    await db.schema.dropTable('NewsItems').execute();
    await db.schema.dropTable('NewsSources').execute();
    await db.schema.dropIndex('NewsDateIdx').execute();
    await db.schema.dropIndex('NewsSourceAppIDIdx').execute();
}
