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
	const misc = require('./libs/misc.js')();
	const async_rl = require('./libs/async_rate.js')(logger);

	//------------------------------------------------------------
	// Bacup a CouchDB database
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
		let ending = false;											// dsh todo test code remove me
		let async_options = {};
		let doc_count = 0;
		logger.log('backup preflight starting @', start);

		// end test early - dsh todo remove me
		setTimeout(() => {
			ending = true;
			logger.log('ending early');
			prepare_for_death();
		}, 1000 * 60 * 5);


		options.min_rate_per_sec = options.min_rate_per_sec || 2;		// default
		options.max_parallel = options.max_parallel || 10;				// default
		options.head_room_percent = options.head_room_percent || 20;	// default


		const input_errors = misc.check_inputs(options);				// check if there are any arg mistakes
		if (input_errors.length > 0) {
			logger.error('input errors:\n', input_errors);
			return cb({ input_errors });								// get the hell out of here
		}

		// go go gadget
		get_db_data((errors, data) => {									// get the sequence number and count the docs
			logger.log('backup preflight complete.', data);
			doc_count = data.doc_count;									// hoist scope

			logger.log('\nstarting doc backup @', Date.now());
			async_options = {
				count: Math.ceil(data.doc_count / data.batch_size),		// calc the number of batch apis we will send
				max_rate_per_sec: options.max_rate_per_sec,
				max_parallel: options.max_parallel,
				head_room_percent: options.head_room_percent,
				_pause: false,
				request_opts_builder: (iter) => {						// build the options for each batch clouant api
					const skip = iter * data.batch_size;
					const req_options = {
						method: 'GET',
						baseUrl: options.db_connection,
						url: '/' + options.db_name + '/_all_docs?include_docs=true&limit=' + data.batch_size + '&skip=' + skip,
						headers: {
							'Accept': 'application/json',
						},
						timeout: 2 * 60 * 1000,
						_name: 'batch get',								// name to use in logs
					};
					return req_options;
				}
			};
			async_rl.async_reqs_limit(async_options, (resp, req_cb) => {
				handle_docs(resp);
				return req_cb();
			}, (errs) => {												// all done!
				if (errs) {
					logger.error('[fin] doc backup stopped. errors:');
					logger.error(JSON.stringify(errs, null, 2));
				} else {
					const end = Date.now();
					const elapsed = end - start;
					logger.log('[fin] doc backup complete @', end, misc.friendly_ms(elapsed));
				}
				prepare_for_death();
			});

		});

		// handle the docs in the couchdb responses - write the docs to the stream
		function handle_docs(response) {
			const body = response ? response.body : null;
			const api_id = response ? response.iter : 0;
			const elapsed_ms = response ? response.elapsed_ms : 0;
			const docs = misc.parse_for_docs(body);

			if (docs && docs.length > 0) {
				finished_docs += docs.length;						// keep track of the number of docs we have finished
				const percent = (finished_docs / doc_count * 100).toFixed(1) + '%';
				logger.log('[rec] received resp for api:', api_id + ', # docs:', docs.length +
					', took:', misc.friendly_ms(elapsed_ms) + ', total:', finished_docs, '[' + percent + ']');

				if (ending === false) {
					const write_okay = options.write_stream.write(JSON.stringify(docs) + '\n', 'utf8', write_flushed);
					if (!write_okay) {								// the buffer is full, ALL STOP (wait for drain event)
						if (async_options._pause === false) {
							async_options._pause = true;
							options.write_stream.once('drain', function () {
								async_options._pause = false;		// put it back
							});
							logger.log('[write] stalling couch reads b/c write stream is backed up');
						}
					}
				}
			}

			function write_flushed() {
				logger.log('[write] wrote docs from batch api:', api_id + ', # docs:', docs.length + ', total:', finished_docs);
			}
		}

		// ------------------------------------------------------
		// get initial db data to figure out the batch size
		// ------------------------------------------------------
		function get_db_data(data_cb) {
			couch.get_db_data({ db_name: options.db_name }, (err, resp) => {							// first get the db data for the doc count
				if (err) {
					logger.error('[stats] unable to get basic db data. e:', err);
					return data_cb(err, null);
				} else {
					const avg_doc_bytes = resp.sizes.file / resp.doc_count;
					const batch_size = Math.floor(options.batch_get_bytes_goal / avg_doc_bytes);
					const doc_count = resp.doc_count;
					logger.log('[stats] size:', misc.friendly_bytes(resp.sizes.file));
					logger.log('[stats] docs:', misc.friendly_number(doc_count));
					logger.log('[stats] avg doc:', misc.friendly_bytes(avg_doc_bytes));
					logger.log('[stats] batch size:', batch_size);

					couch.get_changes({ db_name: options.db_name, since: 'now' }, (err2, resp2) => {	// get the changes feed and grab the last seq
						if (err2) {
							logger.error('[stats] unable to get db changes. e:', err2);
							return data_cb(err2, null);
						} else {
							const seq = resp2.last_seq;
							return data_cb(err, { batch_size, seq, doc_count });						// pass the data we need on
						}
					});
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
