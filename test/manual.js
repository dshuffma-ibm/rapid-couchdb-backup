
const fs = require('fs');
const rapid_couchdb = require('../warp_speed.js')(console);

// ---------------------------------- Editable Settings  ---------------------------------- //
const BATCH_GET_BYTES_GOAL = 1 * 1024 * 1024;			// MiB
const MAX_RATE_PER_SEC = 10;							// the maximum number of api requests to send per second
const MAX_PARALLEL = 30;								// this can be really high, ideally the rate limiter is controlling the load, not this field
const HEAD_ROOM_PERCENT = 20;	 						// how much of the real rate limit should be left unused. (20% -> will use 80% of the rate limit)
const secrets = require('../env/secrets.json');
// ------------------------------------------------

// ------------------------------------------------
// [test runs] - 50GB
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


// ------------------------------------------------
// [test runs] - 275MB - 581k docs (0 deleted docs - 0%) 2033 batch size
//   1, 10, 30 -> took: 4.5 minutes [331MB]
//   1, 10, 30 -> took: 4.4 minutes [331MB]

// [test runs] - 290MB - 295k docs (286k deleted docs - 49%) 1014 batch size
//   1, 10, 30 -> took: 2.6 minutes [168MB]
//   1, 10, 30 -> took: 2.7 minutes [168MB]

// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 451 batch size
//   1, 10, 30 -> took: 3.0 minutes [82MB]

// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 1014 batch size
//   1, 10, 30 -> took: 1.0 minutes [82MB]

// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 2014 batch size
//   1, 10, 30 -> took: 38.1 seconds [82MB]

// !
// [test runs] - 299MB - 629k docs (0 deleted docs - 0%) 2037 batch size
//   1, 10, 30 -> took:  8.7 minutes [360MB]
//   1, 10, 30 -> took:  9.0 minutes [360MB]

// small
// [test runs] - 4.2MB - 2k docs (0 deleted docs - 0%) 269 batch size
//    took: 3.4 seconds [6.9MB]
//    took: 4.0 seconds [6.9MB]

// micro
// [test runs] - 32KB - 17 docs (0 deleted docs - 0%) 1853 batch size
//    took: 494 ms [10.8 KB]
//    took: 513 ms [10.8 KB]
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
rapid_couchdb.backup(opts, () => {
	console.log('fin.');
});
