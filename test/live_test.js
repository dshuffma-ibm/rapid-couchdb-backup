
const fs = require('fs');
const rapid_couchdb = require('../warp_speed.js')(console);
let secrets = {
	couchdb_url: process.env.COUCHDB_URL,				// this is set by a github action, unless running locally
	db_name: 'rapid_backup_test',
};

try {
	secrets = require('../env/secrets.json');			// if running locally, pull from this file
} catch (e) { }

console.log('running on db:', secrets.db_name);
const opts = {
	couchdb_url: secrets.couchdb_url,
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
});
