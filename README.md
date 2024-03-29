# Rapid Backup

A couchdb database backup tool focusing on **speed** and **rate limit controls**.
Will backup active docs in a couchdb database to a [node stream](https://nodejs.org/api/stream.html) (which could be a file or something else).

_Note that this tool does **not** back up deleted docs. See [limitations](#limitations)._


## Rate Limit Controls
This tool will start off with a slow api rate and increase it until a 429 response code is received.
It will then lower the internal limit to stay within the rate limit and the `head_room_percent` setting.
It will continue to adjust its internal rate if additional 429 codes are received throughout the backup.
This "room" will allow other applications to continue to access the db without hitting the rate limit.

There are also settings to control min/max rate limits as well as maximum pending requests.
These settings should prevent the backup from overwhelming couchdb!

## Speed
This couchdb backup lib will be much faster than [@cloudant/couchbackup](https://github.com/cloudant/couchbackup) **if the database has a high deleted doc percentage.**
Otherwise it is only faster on large databases and its actually slower on very small databases.

| Backup Test | Rapid Backup | Cloudant CouchBackup | Speed Up |
| ----------- | ----------- | ----------- | ----------- |
| XLarge - 0% deleted    | 1.8 hrs        | 4.8 hrs       | 2.7x
| XLarge - 75% deleted   | 34.5 mins      | 4.9 hrs       | 8.5x
| Large - 0% deleted     | 2.7 mins       | 6.0 mins      | 2.2x
| Large - 75% deleted    | 52.9 secs      | 5.9 mins      | 6.7x
| Small - 0% deleted     | 3.4 secs       | 2.4 secs      | 0.7x (slower)
| Small - 75% deleted    | 1.9 secs       | 2.4 secs      | 1.3

- XLarge - 22M docs, total size 10GB
- Large - 581k docs, total size 275MB
- Small - 2k docs, total size 5MB


## Usage

```js
// to enable detailed logs pass a logger or the console to the lib,
// else logging is disabled. (warning - there are a lot of logs!)
const rapid = require('rapid-couchdb-backup')(console);

// all options are shown below:
const opts = {
	// [required] the database connection url, including basic auth and port if applicable
	couchdb_url: 'https://auth:password@url.com:443',

	// [required] the database name to backup
	db_name: 'my-db',

	// [required] the stream to write the backup to.
	write_stream: fs.createWriteStream('./_backup_docs.json'),

	// [optional] the optimal batch read response size in bytes.
	// This will indirectly set the number of docs to batch read per request.
	// Recommended to set this around 256KB - 1MB (the higher the better, usually).
	// Setting this too high may overwhelm couchdb.
	// defaults 131072 (128KB)
	batch_get_bytes_goal: 128 * 1024,

	// [optional] the maximum number of read queries to spawn per second.
	// If this the rate limit is unknown, leave blank.
	// This lib will auto detect the real rate limit.
	// It will back off once a 429 response code is found.
	// defaults 50
	max_rate_per_sec: 30,

	// [optional] the maximum number of read queries to be waiting on.
	// Setting this too high may overwhelm couchdb (10-50 seems okay).
	// defaults to Math.floor(max_rate_per_sec / get_doc_batch_size) * 2
	// recommended to leave it blank
	max_parallel_reads: undefined,

	// [optional] how much of the real rate limit should be left for other applications.
	// example if 20 is set then only 80% of the detected-rate limit will be used.
	// defaults 20
	head_room_percent: 18,

	// [optional] the minimum number of read queries per second.
	// when the lib encounters a 429 response code it lowers its internal limit.
	// this setting will create a floor for the internal limit.
	// defaults 50
	min_rate_per_sec: 50,

	// [optional] the maximum amount of time to wait on an read api in milliseconds.
	// defaults 240000 (4 minutes)
	read_timeout_ms: 1000 * 60 * 2,

	// [optional] an IBM Cloud IAM apikey can be provided.
	// if provide a bearer token authorization header will be used to connect to couch.
	// the access token will be refreshed 5 minutes before it expires.
	// the default iam exchange endpoint is:
	//  - https://identity-3.us-south.iam.cloud.ibm.com/identity/token
	//  - this url can be overwritten with the env var IAM_TOKEN_URL
	iam_apikey: 'asdf',
};

rapid.backup(opts, (errors, date_completed) => {
	console.log('backup completed on:', date_completed);
	if (errors) {
		console.error('looks like we had errors:', JSON.stringify(errors, null, 2));
	}
});
```

## How it Works
The issue with the other backup tools are that they backup the delete history from the `_changes` feed.
That leads to poor performance if you have a ton of deleted docs.
Which only gets worse over time (assuming your applications are creating and deleting docs regularly).
Each delete is still something it will process, so the time for a complete backup will actually grow _indefinitely_!

The number of deleted docs is _mostly_ irrelevant to this lib.
The main variable driving how long a backup will take is the number of docs that are not deleted.

In `phase1` the backup will walk the `_changes` feed and ignore delete entries.
It will keep up to X doc ids in memory at a time.
In `phase2` it will send bulk/batch GET doc apis to receive as many docs as the settings allow.
As the docs come in they will be written to the output stream.
It will then repeat `phase1` and `phase2` until all docs are backed up.
Once its done with that it needs to find if any docs were added/edited since the backup started.
`phase3` will walk the `_changes` feed starting the feed from the start of the backup.
Any new docs or changed docs will be written to the backup.

## Limitations
- **Will only back up active docs.** Meaning the deleted doc history is not part of the backup (with the exception of when a delete happens _during_ the backup process).
- Docs that were deleted _during_ the backup will appear in the beginning of the backup (in the un-deleted state). However they will be followed by their delete stub at the end of the backup data. Since restoring walks the backup the deleted doc will momentarily appear and then be deleted by the end.
- Docs that were edited _during_ the backup will appear twice in the backup data. The latest version is the one towards the end of backup. Since restoring walks the backup the old doc will momentarily appear and then be updated by the end.
- Does not store doc `meta` data such as previous revision tokens.
- Does not back up attachments (this was chosen to preserve compatibility with @cloudant/couchbackup's restore function).

## Backup Structure
Same output as [@cloudant/couchbackup](https://github.com/cloudant/couchbackup#whats-in-a-backup-file).
It's a bunch of naked arrays with doc JSON objects separated by newlines.

```js
[{"_id":"1","_rev":"1-1","d":1},{"_id":"2","_rev":"2-2","d":2}...]
[{"_id":"3","_rev":"3-3","d":3},{"_id":"4","_rev":"4-4","d":4}...]
```

## How to Restore
The output format of this backup is compatible with [@cloudant/couchbackup](https://github.com/cloudant/couchbackup).
Use that lib to restore.
