const secrets = require('../env/secrets.json');
const DEST_FILENAME = '_old_backup.json';

const cl = require('@cloudant/couchbackup');
const fs = require('fs');
const misc = require('../libs/misc.js')();


// ------------------------------------------------
// [test runs] - 275MB - 581k docs (0 deleted docs - 0%) 500 batch size
//    took: 6.0 minutes [370MB]
//    took: 5.9 minutes [370MB]
// [test runs] - 290MB - 295k docs (286k deleted docs - 49%) 500 batch size
//    took: 6.2 minutes [244MB]
//    took: 6.2 minutes [244MB]
// [test runs] - 285MB - 144k docs (436k deleted docs - 75%) 500 batch size
//    took: 5.9 minutes [177MB]
//    took: 5.9 minutes [177MB]
//!
// [test runs] - 299MB - 629k docs (0 deleted docs - 0%) 500 batch size
// spool length error - crash!
//    took: 6.9 minutes [401MB]
//    took: 6.8 minutes [401MB]

// small
// [test runs] - 4.2MB - 2k docs (0 deleted docs - 0%) 500 batch size
//    took: 2.4 seconds [7.1MB]
//    took: 2.5 seconds [7.1MB]

// micro
// [test runs] - 32KB - 17 docs (0 deleted docs - 0%) 500 batch size
//    took: 558 ms [14.1 KB]
//    took: 565 ms [14.1 KB]
// ------------------------------------------------

const start = Date.now();
const options = {
	//bufferSize: 1000,
	//debug: 'couchbackup',
	//mode: 'shallow',
	//log: 'mylogs.json'
};
const cle = cl.backup(
	secrets.db_connection + '/' + secrets.db_name,
	fs.createWriteStream(DEST_FILENAME),
	options,
	function (err, data) {
		const elapsed = Date.now() - start;
		console.log('took', misc.friendly_ms(elapsed));
		if (err) {
			console.error('Failed! ' + err);
		} else {
			console.error('Success! ' + data);
		}
	});

cle.on('changes', (evt) => {
	console.log('changes:', JSON.stringify(evt));
});
cle.on('written', (evt) => {
	console.log('written:', JSON.stringify(evt));
});
cle.on('finished', (evt) => {
	console.log('finished:', JSON.stringify(evt));
});
cle.on('error', (evt) => {
	console.error('error:', JSON.stringify(evt));
});


/* defaults
{
  parallelism: 5,
  bufferSize: 500,
  requestTimeout: 120000,
  log: 'C:\\Users\\DAVIDH~1\\AppData\\Local\\Temp\\tmp-16328-zC426RpAU1CY',
  resume: false,
  mode: 'full'
}

- it is reading 500 at a time, in a stream all in the begining
- 1379, 690000
- 1076, 538500
- 1347, 674000
- 1482, 741500
- 1364, 682500

- it writes every doc id in the change feed into a log file before making any writes to the backup destination
- log file is 4.3GB has doc ids organized into batches

- the shallow mode assumes docs will not be inserted before the start key
- shallow mode will flood as fast a possible, no back pressure or rate limit
- at the current api limits it would take 10 days to do a shallow read

- we can stream the changes, with full doc data, and ignore deleted docs
*/
