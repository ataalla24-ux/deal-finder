// High-frequency app data uses SQLite DO rows instead of the 1,000/day KV write allowance.
// Legacy KV remains read-only during migration; never silently fall back to writing it.
export class HotDataStorage {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS hot_data (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires REAL NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS hot_data_expiry ON hot_data(expires)');
    this.storage = {
      get: async (key, type) => {
        const row = this.sql.exec('SELECT value, expires FROM hot_data WHERE key = ?', key).toArray()[0];
        if (row) return row.expires > Date.now() ? type === 'json' ? JSON.parse(row.value) : row.value : null;
        return env.MERCHANT_CAMPAIGNS.get(key, type);
      },
      put: async (key, value, options) => {
        if (!/^(product-analytics:|deal-interaction)/.test(key) || !Number.isFinite(options?.expirationTtl)) throw Error('Unsupported hot-data write');
        this.sql.exec('INSERT OR REPLACE INTO hot_data VALUES (?, ?, ?)', key, value, Date.now() + options.expirationTtl * 1000);
        const alarm = await ctx.storage.getAlarm();
        if (!alarm || alarm > Date.now() + 3600000) await ctx.storage.setAlarm(Date.now() + 3600000);
      },
      list: async ({ prefix, cursor, limit = 1000 }) => {
        if (!prefix.startsWith('product-analytics:event:')) throw Error('Unsupported hot-data listing');
        if (!cursor || cursor.startsWith('legacy:')) {
          const result = await env.MERCHANT_CAMPAIGNS.list({ prefix, limit, cursor: cursor?.slice(7) || undefined });
          return { keys: result.keys, list_complete: false, cursor: result.list_complete ? 'local:' : 'legacy:' + result.cursor };
        }
        if (!cursor.startsWith('local:')) throw Error('Invalid cursor');
        const rows = this.sql.exec('SELECT key FROM hot_data WHERE key >= ? AND key < ? AND key > ? AND expires > ? ORDER BY key LIMIT ?',
          prefix, prefix + '\uffff', cursor.slice(6), Date.now(), limit + 1).toArray();
        const page = rows.slice(0, limit);
        return { keys: page.map(r => ({ name: r.key })), list_complete: rows.length <= limit,
          cursor: rows.length > limit ? 'local:' + page.at(-1).key : undefined };
      },
    };
  }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(() => this.handle(request, { ...this.env, HOT_DATA: undefined, MERCHANT_CAMPAIGNS: this.storage }));
  }
  async alarm() {
    this.sql.exec('DELETE FROM hot_data WHERE key IN (SELECT key FROM hot_data WHERE expires <= ? ORDER BY expires LIMIT 1000)', Date.now());
    const row = this.sql.exec('SELECT MIN(expires) AS expires FROM hot_data').toArray()[0];
    if (row?.expires != null) await this.ctx.storage.setAlarm(Math.max(Date.now() + 60000, row.expires));
  }
}
