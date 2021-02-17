//------------------------------------------------------------
// live_test.js - run rapid backup against a real db and check output
//------------------------------------------------------------
const fs = require('fs');
const cl = require('@cloudant/couchbackup');
const misc = require('../libs/misc.js')();
const rapid_couchdb = require('../warp_speed.js')(console);
const DEST_FILENAME = './_old_backup.json';
let sorted_old_backup = [];
let secrets = {
	couchdb_url: process.env.COUCHDB_URL,						// this is set by a github action, unless running locally
	db_name: 'rapid_backup_test',
};

try {
	secrets = require('../env/secrets.json');					// if running locally, pull from this file
} catch (e) { }

// -----------------------------
// first run the old one to get a base line
// -----------------------------
run_old(() => {
	console.log('\n\n--- cloudant backup finished ---\n\n');
	const old_backup = fs.readFileSync(DEST_FILENAME).toString();
	sorted_old_backup = misc._clean_backup_data(old_backup);

	console.log('--- starting rapid test 1 ---');				// the first tests will iter on multiple loops
	run_rapid({
		test: 'test1',
		couchdb_url: secrets.couchdb_url,
		db_name: secrets.db_name,
		max_rate_per_sec: 5,									// set a low number to be nice
		max_parallel_reads: 5,									// set a low number to be nice
		batch_get_bytes_goal: 32 * 1024,						// set to 32KB to force it to write multiple lines to backup, better test
		write_stream: fs.createWriteStream('./_backup_docs.json'),
		_MAX_STUBS_IN_MEMORY: 2000,								// set this low to force looping, makes a better test
	}, () => {
		console.log('\n\n--- rapid test 1 finished ---\n\n');

		console.log('--- starting rapid test 2 ---');
		run_rapid({												// the second test will only do 1 loop
			test: 'test2',
			couchdb_url: secrets.couchdb_url,
			db_name: secrets.db_name,
			max_rate_per_sec: 5,								// set a low number to be nice
			max_parallel_reads: 5,								// set a low number to be nice
			batch_get_bytes_goal: 1 * 1024 * 1024,				// set to large to write a single line to backup
			write_stream: fs.createWriteStream('./_backup_docs.json'),
		}, () => {
			console.log('\n\n--- rapid test 2 finished ---\n\n');
			console.log('success, active backup content matches :)');
		});
	});
});


//------------------------------------------------------------
// run the rapid backup
//------------------------------------------------------------
function run_rapid(opts, cb) {
	rapid_couchdb.backup(opts, (errors, date_completed) => {
		console.log('backup ended:', date_completed);
		if (errors) {
			console.error('looks like we had errors:', errors.length);
			fs.writeFileSync('_backup_error.log', JSON.stringify(errors, null, 2));
			process.exit(1);
		} else {
			let check_errs = check_backup(opts);
			if (check_errs.length > 0) {
				console.error('[check] errors:', JSON.stringify(check_errs, null, 2));
				process.exit(1);
			} else {
				console.log('[check] errors: 0');
				return cb();
			}
		}
	});
}

//------------------------------------------------------------
// run the cloudant backup lib
//------------------------------------------------------------
function run_old(cb) {
	const start = Date.now();
	const options = {};
	const cle = cl.backup(
		secrets.couchdb_url + '/' + secrets.db_name,
		fs.createWriteStream(DEST_FILENAME),
		options,
		function (err, data) {
			const elapsed = Date.now() - start;
			console.log('took', misc.friendly_ms(elapsed));
			if (err) {
				console.error('Failed! ', err);
			} else {
				console.error('Success! ', data);
			}
		});

	cle.on('changes', (evt) => {
		const elapsed = Date.now() - start;
		console.log('changes:', JSON.stringify(evt), 'took', misc.friendly_ms(elapsed));
	});
	cle.on('written', (evt) => {
		const elapsed = Date.now() - start;
		console.log('written:', JSON.stringify(evt), 'took', misc.friendly_ms(elapsed));
	});
	cle.on('finished', (evt) => {
		const elapsed = Date.now() - start;
		console.log('finished:', JSON.stringify(evt), 'took', misc.friendly_ms(elapsed));
		return cb();
	});
	cle.on('error', (evt) => {
		console.error('error:', JSON.stringify(evt));
	});
}


// check if the backup is valid
function check_backup(options) {
	let errors = [];
	const backup = fs.readFileSync('./_backup_docs.json').toString();
	const parts = backup.split('\n');
	console.log('[check] checking backup');
	console.log('[check] found newline parts: ', parts.length);

	for (let i in parts) {										// skip the blank lines
		if (parts[i]) {
			try {
				const valid = JSON.parse(parts[i]);
				console.log('[check] found sub-section:', i, 'len:', valid.length);
			} catch (e) {
				errors.push('unable to parse part ' + i);		// each part should be a valid naked array
			}
		}
	}

	const sorted_backup = misc._clean_backup_data(backup);
	console.log('[check] sorted backup len:', sorted_backup.length);
	console.log('[check] sorted old backup len:', sorted_old_backup.length);
	if (JSON.stringify(sorted_backup) !== JSON.stringify(sorted_old_backup)) {
		errors.push('backups do not match. id: ' + options.test);
	}
	return errors;
}
