// verify_better_sqlite3.js — confirm the native addon loads and works.
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE t(x INTEGER)');
db.prepare('INSERT INTO t VALUES (?)').run(42);
const row = db.prepare('SELECT x FROM t').get();
console.log('better-sqlite3 OK, value =', row.x);
console.log('node version =', process.version);
