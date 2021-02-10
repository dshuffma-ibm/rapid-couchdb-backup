//------------------------------------------------------------
// warp_speed.js
//------------------------------------------------------------
const misc = require('./libs/misc.js')();
const async_rl = require('./libs/async_rate.js')(console);
const secrets = require('./env/secrets.json');
const couch = require('./libs/couchdb.js')(secrets.db_connection);
const DB_NAME = secrets.db_name;
let finished_docs = 0;

// ---------------------------------- Edit Settings  ---------------------------------- //
const BATCH_GET_BYTES_GOAL = 1 * 1024 * 1024;			// MiB
let MAX_RATE_PER_SEC = 10;								// the maximum number of api requests to send per second
let MAX_PARALLEL = 30;									// this can be really high, ideally the rate limiter is controlling the load, not this field
const HEAD_ROOM_PERCENT = 80;	 						// how much of the real rate limit should be used for this task (80 -> 80% of the rate limit)

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

// end test early
setTimeout(() => {
	console.log('ending early');
	process.exit();
}, 1000 * 60 * 5);
// ------------------------------------------------

const start = Date.now();
console.log('backup preflight starting @', start);
get_db_data((errors, data) => {								// get the sequence number and count the docs
	console.log('backup preflight complete.', data);

	console.log('\nstarting doc backup @', Date.now());
	const async_options = {
		count: Math.ceil(data.doc_count / data.batch_size),	// calc the number of batch apis we will send
		max_rate_per_sec: MAX_RATE_PER_SEC,
		max_parallel: MAX_PARALLEL,
		head_room_percent: HEAD_ROOM_PERCENT,
		request_opts_builder: (iter) => {					// build the options for each batch clouant api
			const skip = iter * data.batch_size;
			const req_options = {
				method: 'GET',
				baseUrl: secrets.db_connection,
				url: '/' + DB_NAME + '/_all_docs?include_docs=true&limit=' + data.batch_size + '&skip=' + skip,
				headers: {
					'Accept': 'application/json',
				},
				timeout: 2 * 60 * 1000,
				_name: 'batch get',							// name to use in logs
			};
			return req_options;
		}
	};
	async_rl.async_reqs_limit(async_options, (response, req_cb) => {
		const body = response ? response.body : null;
		if (body && body.rows) {
			const elapsed_ms = response ? response.elapsed_ms : 0;
			const api_id = response ? response.iter : 0;
			finished_docs += body.rows.length;				// keep track of the number of docs we have finished
			const percent = (finished_docs / data.doc_count * 100).toFixed(1) + '%';
			console.log('[rec] received api:', api_id + ', # docs:', body.rows.length +
				', took:', misc.friendly_ms(elapsed_ms) + ', total:', finished_docs, '[' + percent + ']');
		}
		return req_cb();
	}, (errs) => {												// all done!
		if (errs) {
			console.error('[fin] doc backup stopped. errors:');
			console.error(JSON.stringify(errs, null, 2));
		} else {
			const end = Date.now();
			const elapsed = end - start;
			console.log('[fin] doc backup complete @', end, misc.friendly_ms(elapsed));
		}
		process.exit(1);		// dsh todo remove this...
	});
});

// ------------------------------------------------------
// get initial db data to figure out the batch size
// ------------------------------------------------------
function get_db_data(cb) {
	couch.get_db_data({ db_name: DB_NAME }, (err, resp) => {								// first get the db data for the doc count
		if (err) {
			console.error('[stats] unable to get basic db data. e:', e);
			return cb(err, null);
		} else {
			const avg_doc_bytes = resp.sizes.file / resp.doc_count;
			const batch_size = Math.floor(BATCH_GET_BYTES_GOAL / avg_doc_bytes);
			const doc_count = resp.doc_count;
			console.log('[stats] size:', misc.friendly_bytes(resp.sizes.file));
			console.log('[stats] docs:', misc.friendly_number(doc_count));
			console.log('[stats] avg doc:', misc.friendly_bytes(avg_doc_bytes));
			console.log('[stats] batch size:', batch_size);

			couch.get_changes({ db_name: DB_NAME, since: 'now' }, (err2, resp2) => {	// get the changes feed and grab the last seq
				if (err2) {
					console.error('[stats] unable to get db changes. e:', e);
					return cb(err2, null);
				} else {
					const seq = resp2.last_seq;
					return cb(err, { batch_size, seq, doc_count });						// pass the data we need on
				}
			});
		}
	});
}
