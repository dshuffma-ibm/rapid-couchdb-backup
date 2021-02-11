//------------------------------------------------------------
// warp_speed.js
//------------------------------------------------------------
module.exports = function (logger) {
	const exports = {};
	const misc = require('./libs/misc.js')();
	const async_rl = require('./libs/async_rate.js')(console);

	//------------------------------------------------------------
	// Bacup a CouchDB database
	//------------------------------------------------------------
	/*
	options: {
		db_connection: 'https://apikey-:pass@account.cloudant.com',
		db_name: 'database',
		max_rate_per_sec: 50,
		max_parallel: 10,
		head_room_percent: 20,
		batch_get_bytes_goal: 1 * 1024 * 1024,
		target_stream: null,
	}
	*/
	exports.backup = (options) => {
		const start = Date.now();
		const couch = require('./libs/couchdb.js')(options.db_connection);
		let finished_docs = 0;
		let ending = false;											// dsh todo test code remove me
		console.log('backup preflight starting @', start);

		// end test early - dsh todo remove me
		setTimeout(() => {
			ending = true;
			console.log('ending early');
			prepare_for_death();
		}, 1000 * 60 * 5);

		get_db_data((errors, data) => {								// get the sequence number and count the docs
			console.log('backup preflight complete.', data);

			console.log('\nstarting doc backup @', Date.now());
			const async_options = {
				count: Math.ceil(data.doc_count / data.batch_size),	// calc the number of batch apis we will send
				max_rate_per_sec: options.max_rate_per_sec,
				max_parallel: options.max_parallel,
				head_room_percent: options.head_room_percent,
				_pause: false,
				request_opts_builder: (iter) => {					// build the options for each batch clouant api
					const skip = iter * data.batch_size;
					const req_options = {
						method: 'GET',
						baseUrl: options.db_connection,
						url: '/' + options.db_name + '/_all_docs?include_docs=true&limit=' + data.batch_size + '&skip=' + skip,
						headers: {
							'Accept': 'application/json',
						},
						timeout: 2 * 60 * 1000,
						_name: 'batch get',							// name to use in logs
					};
					return req_options;
				}
			};
			async_rl.async_reqs_limit(async_options, (resp, req_cb) => {
				handle_docs(resp);
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
				prepare_for_death();
			});

			// handle the docs in the couchdb responses - write the docs to the stream
			function handle_docs(response) {
				const body = response ? response.body : null;
				const api_id = response ? response.iter : 0;
				const elapsed_ms = response ? response.elapsed_ms : 0;
				const docs = parse_for_docs(body);

				if (docs && docs.length > 0) {
					finished_docs += docs.length;						// keep track of the number of docs we have finished
					const percent = (finished_docs / data.doc_count * 100).toFixed(1) + '%';
					console.log('[rec] received resp for api:', api_id + ', # docs:', docs.length +
						', took:', misc.friendly_ms(elapsed_ms) + ', total:', finished_docs, '[' + percent + ']');

					if (ending === false) {
						const write_okay = options.target_stream.write(JSON.stringify(docs) + '\n', 'utf8', write_flushed);
						if (!write_okay) {								// the buffer is full, ALL STOP (wait for drain event)
							if (async_options._pause === false) {
								async_options._pause = true;
								options.target_stream.once('drain', function () {
									async_options._pause = false;		// put it back
								});
								console.log('[write] stalling couch reads b/c write stream is backed up');
							}
						}
					}
				}

				function write_flushed() {
					console.log('[write] wrote docs from batch api:', api_id + ', # docs:', docs.length + ', total:', finished_docs);
				}
			}
		});

		// ------------------------------------------------------
		// get initial db data to figure out the batch size
		// ------------------------------------------------------
		function get_db_data(cb) {
			couch.get_db_data({ db_name: options.db_name }, (err, resp) => {								// first get the db data for the doc count
				if (err) {
					console.error('[stats] unable to get basic db data. e:', err);
					return cb(err, null);
				} else {
					const avg_doc_bytes = resp.sizes.file / resp.doc_count;
					const batch_size = Math.floor(options.batch_get_bytes_goal / avg_doc_bytes);
					const doc_count = resp.doc_count;
					console.log('[stats] size:', misc.friendly_bytes(resp.sizes.file));
					console.log('[stats] docs:', misc.friendly_number(doc_count));
					console.log('[stats] avg doc:', misc.friendly_bytes(avg_doc_bytes));
					console.log('[stats] batch size:', batch_size);

					couch.get_changes({ db_name: options.db_name, since: 'now' }, (err2, resp2) => {	// get the changes feed and grab the last seq
						if (err2) {
							console.error('[stats] unable to get db changes. e:', err2);
							return cb(err2, null);
						} else {
							const seq = resp2.last_seq;
							return cb(err, { batch_size, seq, doc_count });						// pass the data we need on
						}
					});
				}
			});
		}

		// ------------------------------------------------------
		// end the backup
		// ------------------------------------------------------
		function prepare_for_death() {
			console.log('[write] ending write stream');
			options.target_stream.write('\n');
			options.target_stream.end('', 'utf8', function () {
				process.exit();
			});
		}

		// ------------------------------------------------------
		// Pull each doc field out of the response
		// ------------------------------------------------------
		function parse_for_docs(body) {
			let ret = [];
			if (body && body.rows) {
				for (let i in body.rows) {
					if (body.rows[i].doc) {
						ret.push(body.rows[i].doc);
					}
				}
			}
			return ret;
		}
	};

	return exports;
};
