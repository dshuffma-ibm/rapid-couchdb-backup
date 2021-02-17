
const fs = require('fs');
const rapid_couchdb = require('../warp_speed.js')(console);
const secrets = require('../env/secrets.json');

const opts = {
	db_connection: secrets.db_connection,
	db_name: secrets.db_name,
	max_rate_per_sec: 50,
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
//    took: 3.7 seconds [6.9MB] (324k/min) | {0.06166min -> 0.65x}
//    took: 3.7 seconds [6.9MB]
//    took: 3.2 seconds [6.9MB]

// warp 2 - large deletes
// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 2014 batch size
//   1, 80, 50 -> took: 39.8 seconds [82MB]
//   1, 80, 50 -> took: 40.9 seconds [82MB] (211k/min) (417MB/min) | {0.68min -> 8.68x}
//   1, 80, 50 -> took: 39.8 seconds [82MB]

// warp 2 - xlarge (took 30min just to get 4M doc stubs...)
// [test runs] - 10.6GB - 22.7M docs (4 deleted docs - 0%) 2058 batch size
//   1, 80, 50 -> took: (gave up, about 4-5 hours) [-MB]

// ! warp 3 large - 0 deletes
// [test runs] - 299MB - 629k docs (0 deleted docs - 0%) 2037 batch size
//   1, 50 -> took: 2.7 minutes [360MB] (233k/min) (111MB/min) | {2.7min -> 2.5x}
//   1, 50 -> took: 2.7 minutes [360MB] (233k/min) (111MB/min) | {2.7min -> 2.5x}

// warp 3 - large deletes
// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 2014 batch size
//   1, 50 -> took: 47.7 seconds [82MB] (181k/min) (358MB/min) | {0.795min -> 7.4x}
//   1, 50 -> took: 47.6 seconds [82MB] (182k/min) (359MB/min) | {0.793min -> 7.4x}
//   1, 50 -> took: 54.1 seconds [82MB] (159k/min) (316MB/min) | {0.902min -> 6.5x}

// warp 3 - xlarge  (took 48 seconds to get 4M doc stubs!)
// [test runs] - 10.6GB - 22.7M docs (4 deleted docs - 0%) 2058 batch size
//   1, 80, 50 -> took:  1.8 hrs [12.6GB]
/*
[fin] the # of finished docs is good. found: 22,862,831 db: 22,859,446
[fin] [
  "finished L1 phase 1 - 2.2 mins, docs:0",
  "finished L1 phase 2 - 18.8 mins, docs:4000000",
  "finished L2 phase 1 - 20.8 mins, docs:4000000",
  "finished L2 phase 2 - 37.5 mins, docs:7999998",
  "finished L3 phase 1 - 39.5 mins, docs:7999998",
  "finished L3 phase 2 - 56.9 mins, docs:11999997",
  "finished L4 phase 1 - 58.9 mins, docs:11999997",
  "finished L4 phase 2 - 1.3 hrs, docs:15999997",
  "finished L5 phase 1 - 1.3 hrs, docs:15999997",
  "finished L5 phase 2 - 1.6 hrs, docs:19999996",
  "finished L6 phase 1 - 1.6 hrs, docs:19999996",
  "finished L6 phase 2 - 1.8 hrs, docs:22862831",
  "finished phase 3 - 1.8 hrs, docs:22862831"
]
*/

// warp 3 small
// [test runs] - 4.5MB - 2k docs (0 deleted docs - 0%) 269 batch size
//    took: 3.8 seconds [6.9MB] (32k/min) | {0.0633min -> 0.63x}
//    took: 3.4 seconds [6.9MB] (35k/min) | {0.0567min -> 0.7x}

// warp 3 micro
// [test runs] - 4.8MB - 155 docs (5.75k deleted docs - 97%) 2967 batch size
//    took: 1.4 seconds [55KB] | {0.0233min -> 1.8x}
//    took: 1.6 seconds [55KB] | {0.0267min -> 1.6x}
// ------------------------------------------------
