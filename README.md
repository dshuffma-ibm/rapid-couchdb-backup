# rapid-couchdb-backup

A couchdb database backup tool focusing on **speed** and **rate limit controls**.
Will backup active docs in a couchdb database to a [node stream](https://nodejs.org/api/stream.html) (which could be a file or something else).

## Rate Limit Controls

This tool will start off with a slow api rate and increase it until a 429 response code is received.
It will then lower the internal limit to stay within the rate limit and the `head_room_percent` setting.
It will continue to adjust its internal rate if additional 429 codes are recevied throughout the backup.
This "room" will allow other applictions to continue to access the db without hitting the rate limit.

There are also settings to control min/max rate limits as well as maximum pending requests.
These settings should prevent the backup from overwhelming couchdb!

## Speed

This couchdb backup lib will be much faster than [@cloudant/couchbackup](https://github.com/cloudant/couchbackup) **if the database has a high deleted doc percentage.**
Otherwise it is only a little faster on large databases and its actually slower on very small databases.

| Backup Test | Rapid Backup      | Cloudant CouchBackup | Speed Up |
| ----------- | ----------- | ----------- | ----------- |
| XLarge - 0% deleted    | 15.1 hrs       | 16.7 hrs       | 1.1x
| XLarge - 50% deleted   | 2.7 hrs        | 16.5 hrs       | 6.1x
| XLarge - 75% deleted   | 34.5 mins      | 16.9 hrs       | 29.4x
| Large - 0% deleted     | 4.4 mins       | 6.0 mins       | 1.7x
| Large - 50% deleted    | 2.7 mins       | 6.2 mins       | 2.3x
| Large - 75% deleted    | 39.8 secs      | 5.9 mins       | 8.9x
| Small - 0% deleted     | 4.0 secs       | 2.4 secs       | 0.6x (slower)
| Small - 50% deleted    | 2.5 secs       | 2.4 secs       | 0.9x (slower)

- XLarge - 22M docs, total size 10GB
- Large - 581k docs, total size 275MB
- Small - 2k docs, total size 4MB


## Usage

```js
// to enable detailed logs pass a loger or the console to the lib,
// else logging is disabled
const rapid_couchdb = require('../warp_speed.js')(console);

// all options are shown below:
const opts = {
	// [required] the database connection url, including basic auth and port if applicable
	db_connection: 'https://auth:password@url.com:443',

	// [required] the database name to backup
	db_name: 'my-db',

	// [required] the optimal batch read response size in bytes.
	// This will indirectly set the number of docs to batch read per request.
	// It is recommended to be around 256KB - 1MB.
	// Greater than 2MB may crash couchdb.
	batch_get_bytes_goal: 1 * 1024 * 1024,

	// [required] the stream to write the backup to.
	write_stream: fs.createWriteStream('./_backup_docs.json'),

	// [optional] the maximum number of apis to spawn per second.
	// If this the rate limit is unknown, leave blank.
	// This libe will auto detect the real rate limit.
	// It will back off once a 429 response code is found.
	// defaults 50
	max_rate_per_sec: 30,

	// [optional] the maximum number of global queries to be waiting on.
	// defaults 10
	max_parallel_globals: 8,

	// [optional] the maximum number of read queries to be waiting on.
	// defaults 50
	max_parallel_reads: 40,

	// [optional] how much of the real rate limit should be left for other applications.
	// example if 20 is set then only 80% of the detected-rate limit will be used.
	// defaults 20
	head_room_percent: 18,

	// [optional] the mimum number of qpis to spawn per second.
	// when the lib encounters a 429 response code it lowers its internal limit.
	// this setting will create a floor for the internal limit.
	// defaults 2
	min_rate_per_sec: 2,
};

rapid_couchdb.backup(opts, (errors, date_completed) => {
	console.log('backup completed on:', date_completed);
	if (errors) {
		console.error('looks like we had errors:', JSON.stringify(errors, null, 2));
	}
});
```

## How it Works
The issue with the other backup tools are that they use the `_changes` feed.
That feed performs poorly if you have a ton of deleted docs.
Because each delete entry is still in the `_changes` feed.

This lib does not use the `_changes` feed untill the backup is nearly done.
In `phase1` the backup will grab the list of doc ids in the database.
It will keep up to X doc ids in memory at a time.
In `phase2` it will send bulk/batch GET doc apis to receive as many docs as the settings allow.
It will then repeat `phase1` and `phase2` until all docs are read.
Once its done with that it needs to find if any docs were added/edited since the backup started.
`phase3` will walk the `_changes` feed starting the feed from the start of the backup.

## Limitations
- Docs that were deleted _during_ the backup will appear in the begining of the backup. However they will be followed by their delete stub at the end of the backup data.
- Docs that were edited _during_ the backup will appear twice in the backup data. The latest version is the one towards the end of backup.
- Will only back up active docs. Meaning the deleted doc history is not part of the backup (with the except when the delete happened _during_ the backup process).
- Does not store doc `meta` data such as previous revision tokens.
- Does not back up attachements (this was done to preserve compabilty with @cloudant/couchbackup's restore function).

## Backup Structure
Same output as [@cloudant/couchbackup](https://github.com/cloudant/couchbackup#whats-in-a-backup-file).
It's a bunch of naked arrays with doc JSON objects separated by newlines.

```js
[{"_id":"1","_rev":"1-1","d":1},{"_id":"2","_rev":"2-2","d":2}...]
[{"_id":"3","_rev":"3-3","d":3},{"_id":"4","_rev":"4-4","d":4}...]
```

## How to Restore
The output format of this backup is compatble with [@cloudant/couchbackup](https://github.com/cloudant/couchbackup).
Use that lib to restore.
