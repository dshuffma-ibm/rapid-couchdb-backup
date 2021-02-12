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
				logger.error('[stats] preflight errors:\n', internal_errors);
				return cb({ internal_errors });
			}

			logger.log('[stats] backup preflight complete.');
			doc_count = data.doc_count;									// hoist scope

			logger.log('\nstarting doc backup @', Date.now());

			// dsh todo repeat phase 1 and 2 per 10 million docs
			// pase 1 - get doc ids
			phase1(data, () => {
				logger.log('\nphase 1 complete.', misc.friendly_ms(Date.now() - start), '\n');

				// phase 2 - get docs
				phase2(data, (errs) => {
					if (errs) {
						logger.error('[fin] backup may not be complete. errors:');
						logger.error(JSON.stringify(errs, null, 2));
					} else {
						// dsh todo process changes since start
						logger.log('\nphase 2 complete.', misc.friendly_ms(Date.now() - start), '\n');

						if (finished_docs !== data.doc_count) {
							logger.error('[fin] missing docs... found:', finished_docs, 'db:', data.doc_count);
						} else {
							logger.log('[fin] the doc backup count is correct.');
						}
					}

					// phase 3 - walk changes since start
					// dsh todo test phase 3!!
					phase3(data, (errs) => {
						logger.log('\nphase 3 complete.', misc.friendly_ms(Date.now() - start), '\n');
						prepare_for_death(() => {
							logger.log('[fin] doc backup complete.', misc.friendly_ms(Date.now() - start));
							return cb(null);							// all done
						});
					});
				});
			});
		});

		// phase 1
		function phase1(data, cb) {
			logger.log('[phase 1] starting...');
			const ID_BATCH = 20000;
			async_options = {
				start: start,
				count: calc_count(),									// calc the number of batch apis we will send
				starting_rate_per_sec: 2,								// start low, this is a global query
				max_rate_per_sec: options.max_rate_per_sec,
				max_parallel: options.max_parallel,
				head_room_percent: options.head_room_percent,
				_pause: false,
				request_opts_builder: (iter) => {						// build the options for each batch clouant api
					const skip = (iter - 1) * ID_BATCH;
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
					logger.error('[phase 1] backup may not be complete. errors:');
					logger.error(JSON.stringify(errs, null, 2));
				} else {
					const elapsed = Date.now() - start;
					logger.log('[phase 1] doc backup complete.', misc.friendly_ms(elapsed));
				}
				return cb();
			});

			function calc_count() {
				const MAX_IDS_IN_MEMORY = 10e6;
				if (data.doc_count < MAX_IDS_IN_MEMORY) {
					return Math.ceil(data.doc_count / ID_BATCH);
				} else {
					return Math.ceil(MAX_IDS_IN_MEMORY / ID_BATCH);
				}
			}
		}

		// phase 2
		function phase2(data, cb) {
			logger.log('[phase 2] starting...');
			const CL_MIN_READ_RATE = 100;								// the reading rate of cloudant's cheapest plan
			async_options = {
				start: start,
				count: (data.batch_size === 0) ? 0 : Math.ceil(doc_ids.length / data.batch_size),	// calc the number of batch apis we will send
				starting_rate_per_sec: Math.floor(CL_MIN_READ_RATE * ((100 - options.head_room_percent) / 100)),	// start high, this is a read query
				max_rate_per_sec: CL_MIN_READ_RATE * 2,
				min_rate_per_sec: CL_MIN_READ_RATE / 2,
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
					logger.error('[phase 2] backup may not be complete. errors:');
					logger.error(JSON.stringify(errs, null, 2));
				}
				return cb();
			});
		}

		// phase 3
		function phase3(data, cb) {
			data._changes_iter = data._changes_iter || 1;					// init if needed
			logger.log('[phase 3] starting... i:', data._changes_iter);

			if (data._changes_iter >= 20) {
				logger.log('[phase 3] recursed on changes for too long. giving up.');
				return cb();
			}

			const opts = {
				db_name: options.db_name,
				query: '&since=' + data.seq + '&include_docs=true&limit=' + data.batch_size
			};
			couch.get_changes(opts, (err, body) => {						// get the changes feed
				if (err || !body.results) {
					logger.error('[phase 3] unable to get db changes. e:', err);
					return cb();
				}

				if (body.results.length === 0) {
					logger.log('[phase 3] no changes since backup start.');
					return cb();
				} else {
					const docs = misc.parse_for_docs_changes(body);
					logger.log('[phase 3] parsing changes since backup start.', docs.length);
					write_docs_2_stream('-', docs);

					if (docs.length !== data.batch_size) {
						logger.log('[phase 3] all changes since backup start are processed.');
						return cb();
					} else {
						data._changes_iter++;
						logger.log('[phase 3] there are more changes. getting next batch:', data._changes_iter);
						return phase3(data, cb);
					}
				}
			});
		}

		// handle the docs in the couchdb responses - write the docs to the stream
		function handle_docs(response) {
			const body = response ? response.body : null;
			const api_id = response ? response.iter : 0;
			const doc_elapsed_ms = response ? response.elapsed_ms : 0;
			const docs = misc.parse_for_docs(body);

			if (docs && docs.length > 0) {
				finished_docs += docs.length;					// keep track of the number of docs we have finished
				const percent_docs = finished_docs / doc_count * 100;
				logger.log('[rec] received resp for api:', api_id + ', # docs:', docs.length + ', took:', misc.friendly_ms(doc_elapsed_ms) +
					', total docs:', finished_docs, '[' + (percent_docs).toFixed(1) + '%]');
				predict_time_left(percent_docs);
				write_docs_2_stream(api_id, docs);
			}

			// log much time is left
			function predict_time_left(percent_docs) {
				const job_elapsed_ms = Date.now() - start;
				const estimated_total_ms = (percent_docs === 0) ? 0 : (1 / (percent_docs / 100) * job_elapsed_ms);
				const time_left = estimated_total_ms - job_elapsed_ms;
				logger.log('[estimates] total backup:', misc.friendly_ms(estimated_total_ms) + ', time left:', misc.friendly_ms(time_left));
			}
		}

		// write the docs to the write stream
		function write_docs_2_stream(api_id, docs_array) {
			const write_okay = options.write_stream.write(JSON.stringify(docs_array) + '\n', 'utf8', write_flushed);
			if (!write_okay) {								// the buffer is full, ALL STOP (wait for drain event)
				if (async_options._pause === false) {
					async_options._pause = true;
					options.write_stream.once('drain', function () {
						async_options._pause = false;		// put it back
					});
					//logger.log('[write] stalling couch reads b/c write stream is backed up');
				}
			}

			function write_flushed() {
				logger.log('[write] wrote docs from batch api:', api_id + ', # docs:', docs_array.length + ', total docs:', finished_docs);
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
					couch.get_changes({ db_name: options.db_name, query: '&since=now' }, (err, resp) => {	// get the changes feed and grab the last seq
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
					const avg_doc_bytes = (resp1.doc_count === 0) ? 0 : resp1.sizes.external / resp1.doc_count;
					const batch_size = (avg_doc_bytes === 0) ? 0 : Math.floor(options.batch_get_bytes_goal / avg_doc_bytes);
					const doc_count = resp1.doc_count;
					const del_count = resp1.doc_del_count;
					const seq = resp[1].last_seq;
					logger.log('[stats] size:', misc.friendly_bytes(resp1.sizes.external));
					logger.log('[stats] docs:', misc.friendly_number(doc_count));
					logger.log('[stats] avg doc:', misc.friendly_bytes(avg_doc_bytes));
					logger.log('[stats] batch size:', batch_size);
					logger.log('[stats] deleted docs:', misc.friendly_number(del_count), '-', (del_count / (del_count + doc_count) * 100).toFixed(1) + '%');
					return data_cb(null, { batch_size, seq, doc_count });						// pass the data we need on
				}
			});
		}

		// ------------------------------------------------------
		// end the backup
		// ------------------------------------------------------
		function prepare_for_death(write_cb) {
			logger.log('[write] ending write stream');
			options.write_stream.write('\n');
			options.write_stream.end('', 'utf8', function () {
				return write_cb();
			});
		}
	};

	return exports;
};
