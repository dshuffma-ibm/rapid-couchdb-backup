//------------------------------------------------------------
// warp_speed.js
//------------------------------------------------------------
module.exports = function (logger) {
	const exports = {};
	if (!logger) {											// init dummy logger
		logger = {
			log: () => { },
			error: () => { },
			info: () => { }
		};
	}
	const async = require('async');
	const misc = require('./libs/misc.js')();
	const async_rl = require('./libs/async_rate.js')(logger);

	//------------------------------------------------------------
	// Bacup a CouchDB database (this is the only exposed function in the lib)
	//------------------------------------------------------------
	/*
	options: {
		db_connection: 'https://apikey-:pass@account.cloudant.com',
		db_name: 'database',
		batch_get_bytes_goal: 1 * 1024 * 1024,
		write_stream: null,
		max_rate_per_sec: 50,
		max_parallel: 10,														// [optional]
		head_room_percent: 20,													// [optional]
		min_rate_per_sec: 2,													// [optional]
	}
	*/
	exports.backup = (options, cb) => {
		const start = Date.now();
		const couch = require('./libs/couchdb.js')(options.db_connection);
		let finished_docs = 0;
		let async_options = {};
		let doc_count = 0;
		let doc_ids = [];
		logger.log('backup preflight starting @', start);

		// check input arguments
		options.min_rate_per_sec = options.min_rate_per_sec || 2;		// default
		options.max_parallel = options.max_parallel || 10;				// default
		options.head_room_percent = options.head_room_percent || 20;	// default
		const input_errors = misc.check_inputs(options);				// check if there are any arg mistakes
		if (input_errors.length > 0) {
			logger.error('input errors:\n', input_errors);
			return cb({ input_errors });								// get the hell out of here
		}

		// go go gadget
		get_db_data((internal_errors, data) => {						// get the sequence number and count the docs
			if (internal_errors) {
				logger.error('preflight errors:\n', internal_errors);
				return cb({ internal_errors });
			}

			logger.log('backup preflight complete.');
			doc_count = data.doc_count;									// hoist scope

			logger.log('\nstarting doc backup @', Date.now());

			// pase 1 - get doc ids
			phase1(data, () => {

				// phase 2 - get docs
				phase2(data, (errs) => {
					if (errs) {
						logger.error('[fin] backup may not be complete. errors:');
						logger.error(JSON.stringify(errs, null, 2));
					} else {
						// dsh todo process changes since start
						const elapsed = Date.now() - start;
						logger.log('[fin] doc backup complete.', misc.friendly_ms(elapsed));

						// dsh todo check if we are missing docs...
					}
					prepare_for_death();
				});
			});
		});

		// phase 1
		function phase1(data, cb) {
			const ID_BATCH = 20000;
			async_options = {
				count: calc_count(),									// calc the number of batch apis we will send
				max_rate_per_sec: options.max_rate_per_sec,
				max_parallel: options.max_parallel,
				head_room_percent: options.head_room_percent,
				_pause: false,
				request_opts_builder: (iter) => {						// build the options for each batch clouant api
					const skip = (iter - 1) * 20000;
					return {
						method: 'GET',
						baseUrl: options.db_connection,
						url: '/' + options.db_name + '/_all_docs?limit=' + ID_BATCH + '&skip=' + skip,
						timeout: 2 * 60 * 1000,
						_name: 'phase1',								// name to use in logs
					};
				}
			};
			async_rl.async_reqs_limit(async_options, (resp, req_cb) => {
				handle_ids(resp);
				return req_cb();
			}, (errs) => {												// all done!
				if (errs) {
					logger.error('[phase1] backup may not be complete. errors:');
					logger.error(JSON.stringify(errs, null, 2));
				} else {
					const elapsed = Date.now() - start;
					logger.log('[phase1] doc backup complete.', misc.friendly_ms(elapsed));
				}
				return cb();
			});

			function calc_count() {
				const MAX_IDS_IN_MEMORY = 1e6;
				if (data.doc_count < MAX_IDS_IN_MEMORY) {
					return Math.ceil(data.doc_count / ID_BATCH);
				} else {
					return Math.ceil(MAX_IDS_IN_MEMORY / ID_BATCH);
				}
			}
		}

		// phase 2
		function phase2(data, cb) {
			async_options = {
				count: (data.batch_size === 0) ? 0 : Math.ceil(doc_ids.length / data.batch_size),	// calc the number of batch apis we will send
				max_rate_per_sec: 80,
				min_rate_per_sec: 80,
				max_parallel: 50,
				head_room_percent: options.head_room_percent,
				_pause: false,
				request_opts_builder: (iter) => {						// build the options for each batch clouant api
					const start = (iter - 1) * data.batch_size;
					const end = start + data.batch_size;
					return {
						method: 'POST',
						baseUrl: options.db_connection,
						url: '/' + options.db_name + '/_bulk_get',
						body: JSON.stringify({ docs: doc_ids.slice(start, end) }),
						headers: {
							'Content-Type': 'application/json'
						},
						timeout: 2 * 60 * 1000,
						_name: 'phase2',								// name to use in logs
					};
				}
			};
			async_rl.async_reqs_limit(async_options, (resp, req_cb) => {
				handle_docs(resp);
				return req_cb();
			}, (errs) => {												// all done!
				if (errs) {
					logger.error('[phase2] backup may not be complete. errors:');
					logger.error(JSON.stringify(errs, null, 2));
				} else {
					const elapsed = Date.now() - start;
					logger.log('[phase2] doc backup complete.', misc.friendly_ms(elapsed));
				}
				return cb();
			});
		}

		// handle the docs in the couchdb responses - write the docs to the stream
		function handle_docs(response) {
			const body = response ? response.body : null;
			const api_id = response ? response.iter : 0;
			const elapsed_ms = response ? response.elapsed_ms : 0;
			const docs = misc.parse_for_docs(body);

			if (docs && docs.length > 0) {
				finished_docs += docs.length;					// keep track of the number of docs we have finished
				const percent = (finished_docs / doc_count * 100).toFixed(1) + '%';
				logger.log('[rec] received resp for api:', api_id + ', # docs:', docs.length +
					', took:', misc.friendly_ms(elapsed_ms) + ', total:', finished_docs, '[' + percent + ']');

				const write_okay = options.write_stream.write(JSON.stringify(docs) + '\n', 'utf8', write_flushed);
				if (!write_okay) {								// the buffer is full, ALL STOP (wait for drain event)
					if (async_options._pause === false) {
						async_options._pause = true;
						options.write_stream.once('drain', function () {
							async_options._pause = false;		// put it back
						});
						//logger.log('[write] stalling couch reads b/c write stream is backed up');
					}
				}
			}

			function write_flushed() {
				logger.log('[write] wrote docs from batch api:', api_id + ', # docs:', docs.length + ', total:', finished_docs);
			}
		}

		// handle the doc ids in the couchdb responses
		function handle_ids(response) {
			const body = response ? response.body : null;
			const api_id = response ? response.iter : 0;
			const elapsed_ms = response ? response.elapsed_ms : 0;
			const ids = misc.parse_for_ids(body);

			if (ids && ids.length > 0) {
				logger.log('[rec] received resp for api:', api_id + ', # ids:', ids.length + ', took:', misc.friendly_ms(elapsed_ms));
				doc_ids = doc_ids.concat(ids);
			}
		}

		// ------------------------------------------------------
		// get initial db data to figure out the batch size
		// ------------------------------------------------------
		function get_db_data(data_cb) {
			async.parallel([

				// ---- Get basic db data ---- //
				(join) => {
					couch.get_db_data({ db_name: options.db_name }, (err, resp) => {				// first get the db data for the doc count
						if (err) {
							logger.error('[stats] unable to get basic db data. e:', err);
						}
						return join(err, resp);
					});
				},

				// ---- Get _change sequence ---- //
				(join) => {
					couch.get_changes({ db_name: options.db_name, since: 'now' }, (err, resp) => {	// get the changes feed and grab the last seq
						if (err) {
							logger.error('[stats] unable to get db changes. e:', err);
						}
						return join(err, resp);
					});
				}

			], (error, resp) => {
				if (error || !resp || !resp[0] || !resp[1]) {
					logger.error('[stats] missing data');
					return data_cb(error, null);
				} else {
					const resp1 = resp[0];
					const resp2 = resp[1];
					const avg_doc_bytes = (resp1.doc_count === 0) ? 0 : resp1.sizes.external / resp1.doc_count;
					const batch_size = (avg_doc_bytes === 0) ? 0 : Math.floor(options.batch_get_bytes_goal / avg_doc_bytes);
					const doc_count = resp1.doc_count;
					logger.log('[stats] size:', misc.friendly_bytes(resp1.sizes.external));
					logger.log('[stats] docs:', misc.friendly_number(doc_count));
					logger.log('[stats] avg doc:', misc.friendly_bytes(avg_doc_bytes));
					logger.log('[stats] batch size:', batch_size);
					const seq = resp2.last_seq;
					return data_cb(null, { batch_size, seq, doc_count });						// pass the data we need on
				}
			});
		}

		// ------------------------------------------------------
		// end the backup
		// ------------------------------------------------------
		function prepare_for_death() {
			logger.log('[write] ending write stream');
			options.write_stream.write('\n');
			options.write_stream.end('', 'utf8', function () {
				process.exit();
			});
		}
	};

	return exports;
};
