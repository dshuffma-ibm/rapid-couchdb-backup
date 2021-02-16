
const fs = require('fs');
const rapid_couchdb = require('../warp_speed.js')(console);
const secrets = require('../env/secrets.json');

const opts = {
	db_connection: secrets.db_connection,
	db_name: secrets.db_name,
	max_rate_per_sec: 50,

	// @ 12 i see phase1 reqs taking 2.7 minutes.. (1st round)
	// @ 25 i see phase1 reqs taking over 6 minutes... (2nd round)
	// @ 30 i see phase1 reqs taking 5.3 minutes.. (1st round) phase 1 took 32.1 minutes!
	max_parallel_globals: 50,

	max_parallel_reads: 50,
	head_room_percent: 20,
	batch_get_bytes_goal: 1 * 1024 * 1024,
	write_stream: fs.createWriteStream('./_backup_docs.json'),
};
rapid_couchdb.backup(opts, (errors, date_completed) => {
	console.log('the end:', date_completed);
	if (errors) {
		console.error('looks like we had errors:', errors.length);
		fs.writeFileSync('_backup_error.log', JSON.stringify(errors, null, 2));
	}

	//console.log(process._getActiveHandles());
});

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

// plutus ussouth started: 2021-02-06T21:53:56.518Z
// plutus ussouth finished 2021-02-09T02:18:04.843Z
// took 52.4 hours - 42.6GB - approx 45M docs w/65M deleted docs (59% deleted)

// plutus ussouth started: 2021-02-11T18:00:30.029Z
// plutus ussouth finished 2021-02-11T18:05:35.273Z
// took 5.1 minutes - 393.8MB - 1,747,249 docs, 0 deleted

// ------------------------------------------------
// warp 1 - og large
// [test runs] - 275MB - 581k docs (0 deleted docs - 0%) 2033 batch size
//   1, 10, 30 -> took: 4.5 minutes [331MB] (132k/min) (61MB/min)
//   1, 10, 30 -> took: 4.4 minutes [331MB] (129k/min)

// [test runs] - 290MB - 295k docs (286k deleted docs - 49%) 1014 batch size
//   1, 10, 30 -> took: 2.6 minutes [168MB] (113k/min) ???
//   1, 10, 30 -> took: 2.7 minutes [168MB] (109k/min) (109MB/min) ???

// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 451 batch size
//   1, 10, 30 -> took: 3.0 minutes [82MB] (48k/min) (95MB/min)

// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 1014 batch size
//   1, 10, 30 -> took: 1.0 minutes [82MB] (144k/min) (285MB/min)

// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 2014 batch size
//   1, 10, 30 -> took: 38.1 seconds [82MB] (226k/min) (448MB/min)

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

// ! warp 2 large
// [test runs] - 299MB - 629k docs (0 deleted docs - 0%) 2037 batch size
//   1, 10, 30 -> took:  3.3 minutes [360MB] (190k/min) (90MB/min) | {3.3min -> 2.09x}
//   1, 10, 30 -> took:  3.5 minutes [360MB] (179k/min)
//   1, 80, 50 -> took:  3.3 minutes [360MB] (190k/min)

// warp 2 small
// [test runs] - 4.2MB - 2k docs (0 deleted docs - 0%) 269 batch size
//    took: 3.7 seconds [6.9MB] (32k/min) | {0.06166min -> 0.65x}
//    took: 3.7 seconds [6.9MB]
//    took: 3.2 seconds [6.9MB]

// warp 2 - large deletes
// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 2014 batch size
//   1, 80, 50 -> took: 39.8 seconds [82MB]
//   1, 80, 50 -> took: 40.9 seconds [82MB] (211k/min) (417MB/min) | {0.68min -> 8.68x}
//   1, 80, 50 -> took: 39.8 seconds [82MB]

// warp 2 - xlarge
// [test runs] - 10.6GB - 22.7M docs (4 deleted docs - 0%) 2058 batch size
//   1, 80, 50 -> took:  [MB]
// ------------------------------------------------
