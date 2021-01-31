let sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database("db.sqlite3");

// Initialize Table
var streamers  = `CREATE TABLE IF NOT EXISTS streamers
                    (streamer TEXT NOT NULL);`

create_table (streamers);

function create_table (sql) {
  db.run(sql, err => {
    if (err) {
      return console.error(err.message);
    }
    console.log("DB table query ran");
  });
}

module.exports = db;