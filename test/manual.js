
const fs = require('fs');
const secrets = require('../env/secrets.json');
const rapid_backup = require('../warp_speed.js')(console);

// ---------------------------------- Editable Settings  ---------------------------------- //
const BATCH_GET_BYTES_GOAL = 1 * 1024 * 1024;			// MiB
let MAX_RATE_PER_SEC = 10;								// the maximum number of api requests to send per second
let MAX_PARALLEL = 30;									// this can be really high, ideally the rate limiter is controlling the load, not this field
const HEAD_ROOM_PERCENT = 20;	 						// how much of the real rate limit should be left unused. (20% -> will use 80% of the rate limit)

// ------------------------------------------------
// [test runs]
// 0.5, 10, 50 = 20.8 hours in 5 minutes
//   1, 10, 50 = 13.2 hours in 5 minutes (timeout errors @ 4 minutes in) [tested twice]
//   1, 10, 20 = 17.6 hours in 5 minutes
//   1, 10, 25 = 16.1 hours in 5 minutes
//   1, 10, 30 = 14.9 hours in 5 minutes
//   1, 10, 35 = 13.9 hours in 5 minutes
//   1, 10, 40 = 14.9 hours in 5 minutes (timeout errors @ 5 minutes in)

//   2, 10, 30 = 10.6 hours in 5 minutes (timeout errors @ 3.5 minutes in)
// 0.5, 10, 30 = 22.9 hours in 5 minutes

//0.75, 10, 30 = 17.0 hours in 5 minutes [api resp grew to 43 seconds]
//   1, 10, 30 = 15.4 hours in 5 minutes [api resp grew to 46 seconds]
// 1.5, 10, 30 = 12.5 hours in 5 minutes [api resp grew to 58 seconds]
// ------------------------------------------------

const opts = {
	db_connection: secrets.db_connection,
	db_name: secrets.db_name,
	max_rate_per_sec: MAX_RATE_PER_SEC,
	max_parallel: MAX_PARALLEL,
	head_room_percent: HEAD_ROOM_PERCENT,
	batch_get_bytes_goal: BATCH_GET_BYTES_GOAL,
	write_stream: fs.createWriteStream('./_backup_docs.json'),
};
rapid_backup.backup(opts, () => {
	console.log('fin.');
});
