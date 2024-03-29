//------------------------------------------------------------
// warp_speed.js
//------------------------------------------------------------
module.exports = function (logger) {
	const exports = {};
	if (!logger) {											// init dummy logger
		logger = {
			log: () => { },
			debug: () => { },
			error: () => { },
			info: () => { }
		};
	}
	logger.debug = (!logger.debug && logger.log) ? logger.log : logger.debug;
	logger.info = (!logger.info && logger.log) ? logger.log : logger.info;
	logger.warn = (!logger.warn && logger.log) ? logger.log : logger.warn;

	const async = require('async');
	const stream = require('stream');
	const axios = require('axios').default;
	const misc = require('./libs/misc.js')();
	const async_rl = require('./libs/async_rate.js')(logger);
	const changes = require('./libs/changes.js');
	const break_lines = require('./libs/break-lines.js');
	const iam_lib = require('./libs/iam_lib.js')(logger);

	//------------------------------------------------------------
	// Backup a CouchDB database (this is the only exposed function in the lib)
	//------------------------------------------------------------
	/*
	options: {
		couchdb_url: 'https://apikey-:pass@account.cloudant.com',
		db_name: 'database',
		batch_get_bytes_goal: 1 * 1024 * 1024,
		write_stream: null,
		max_rate_per_sec: 50,													// [optional]
		max_parallel_reads: 10,													// [optional]
		head_room_percent: 20,													// [optional]
		min_rate_per_sec: 50,													// [optional]
		read_timeout_ms: 120000,												// [optional]
		iam_apikey: '1231'														// [optional]
	}
	*/
	exports.backup = (options, cb) => {
		logger.info('[rapid] started.');
		if (!options.iam_apikey) {									// no key, no need
			start_da_backup();
		} else {													// yes key, yes need
			iam_lib.start_watch_dog();
			iam_lib.prepare_refresh(options.iam_apikey);
			iam_lib.get_iam_key(options, () => {
				start_da_backup();
			});
		}

		function start_da_backup() {
			exports.start_backup(options, (errors, response) => {
				if (options.iam_apikey) {
					iam_lib.stop_refresh(options.iam_apikey);
					iam_lib.safe_kill_watch_dog();
				}
				logger.info('[rapid] finished.');
				return cb(misc.order_errors(errors), response);
			});
		}
	};

	//------------------------------------------------------------
	// Backup a CouchDB database (this is the only exposed function in the lib)
	//------------------------------------------------------------
	exports.start_backup = (options, cb) => {
		const start = Date.now();
		options._base_url = misc.get_base_url(options.couchdb_url);
		const couch = require('./libs/couchdb.js')(options._base_url);
		let finished_docs = 0;
		let async_options = {};												// this needs to be at this scope so the write stream can pause it
		let num_all_db_docs = 0;
		let doc_stubs = [];
		const db_errors = [];
		const MAX_STUBS_IN_MEMORY = options._MAX_STUBS_IN_MEMORY || 4e6;	// keep up to 4M doc stubs in memory (doc stubs are around 128 bytes each)
		let high_ms = 0;
		let metrics = [];
		let last_sequence = 0;
		let changes_this_loop = 0;
		let pending_sequences = '-';
		iam_lib.add_progress();


		logger.info('[stats] backup preflight starting @', start);

		// check input arguments
		options.batch_get_bytes_goal = options.batch_get_bytes_goal || 128 * 1024;	// default 128KB
		options.read_timeout_ms = options.read_timeout_ms || 1000 * 60 * 4;	// default 4 min
		options.max_rate_per_sec = options.max_rate_per_sec || 100;			// default
		options.min_rate_per_sec = options.min_rate_per_sec || 50;			// default
		options.head_room_percent = options.head_room_percent || 20;		// default
		const input_errors = misc.check_inputs(options);					// check if there are any arg mistakes
		if (input_errors.length > 0) {
			logger.error('input errors:\n', input_errors);
			return cb({ input_errors });									// get the hell out of here
		}

		// go go gadget
		get_db_data((internal_errors_arr, data) => {						// get the sequence number and count the docs
			if (internal_errors_arr) {
				// already logged
				return cb(internal_errors_arr);
			}

			num_all_db_docs = data.doc_count;								// hoist scope

			// process a few million docs per loop
			logger.log('\nstarting doc backup @', Date.now());
			millions_doc_loop(data, (loop_err_arr) => {
				if (loop_err_arr) {
					logger.error('[loop] backup errors:\n', loop_err_arr);
					return cb(loop_err_arr);
				}

				if (async_options._all_stop === true) {
					logger.error('[loop] ALL STOP (db is mia)');
					return cb(db_errors);									// all done
				}

				// phase 3 - walk changes since start
				data.seq = last_sequence || data.seq;
				phase3(data, () => {
					const d = new Date();
					logger.log('[phase 3] complete.', misc.friendly_ms(Date.now() - start), '\n');
					metrics.push('finished phase 3 - ' + misc.friendly_ms(Date.now() - start) + ', docs:' + finished_docs);

					if (finished_docs < data.doc_count) {
						logger.warn('[fin] missing docs... found:', finished_docs + ', db had @ start', data.doc_count);
					} else {
						logger.log('[fin] the # of finished docs is good. found:', finished_docs + ', db had @ start:', data.doc_count);
					}

					prepare_for_death(() => {
						logger.log('[fin] db:', options.db_name);
						logger.log('[fin] doc backup complete.', misc.friendly_ms(Date.now() - start));
						logger.log('[fin] backup errors:', db_errors.length);
						logger.log('[fin]', JSON.stringify(metrics, null, 2));
						logger.log('[fin]', d, '\n');

						if (db_errors.length === 0) {								// all done
							return cb(null, d);
						} else {
							return cb(db_errors, d);
						}
					});
				});
			});
		});

		// repeat phase 1 and 2 until all docs are backed up. will do MAX_STUBS_IN_MEMORY doc-stubs per loop. - RECURSIVE
		// i'm doing this loop to limit the size of the doc stubs we keep in memory.
		function millions_doc_loop(data, million_cb) {
			data._doc_id_iter = data._doc_id_iter || 1;								// init if needed
			data._skip_offset = data._skip_offset || 0;								// init if needed
			if (data._doc_id_iter * MAX_STUBS_IN_MEMORY >= 100e6) {					// don't recurse forever, at some point give up
				logger.log('[loop] recursed on doc stubs for too long. giving up.', data._doc_id_iter);
				return million_cb();
			}
			logger.log('\n[loop -', data._doc_id_iter + ']');

			// pase 1 - get doc stubs
			doc_stubs = [];															// reset per loop
			changes_this_loop = 0;
			phase1(data, (p1_err, ret) => {
				if (p1_err) {
					// already logged
					return million_cb(p1_err);
				}

				logger.log('[phase 1] complete. active stubs this loop:', doc_stubs.length, 'elapsed:', misc.friendly_ms(Date.now() - start));
				metrics.push('finished L' + data._doc_id_iter + ' phase 1 - ' + misc.friendly_ms(Date.now() - start) + ', docs:' + finished_docs);

				// phase 2 - get the docs & write each to stream
				phase2(data, (errs) => {
					if (errs) {
						logger.error('[fin] backup may not be complete. errors:');
						logger.error(JSON.stringify(errs, null, 2));
					}
					if (async_options._all_stop === true) {
						logger.error('[fin] ALL STOP (db is mia)');
						return million_cb(errs);									// all done
					}

					metrics.push('finished L' + data._doc_id_iter + ' phase 2 - ' + misc.friendly_ms(Date.now() - start) + ', docs:' + finished_docs);

					logger.log('[loop -', data._doc_id_iter + '] active stubs this loop:', doc_stubs.length, 'total:', finished_docs,
						'pending_sequences:', pending_sequences, 'changes_this_loop:', changes_this_loop);
					if (options.iam_apikey) {
						logger.info('[iam] access token expires in: ' + misc.friendly_ms(iam_lib.get_time_left(options.iam_apikey)));
					}

					if (pending_sequences > 0) {									// if there are more pending changes then there are more docs to get
						logger.log('[phase 2] more docs to handle. going back to phase 1. completed loops:', data._doc_id_iter + '/' + data.loops);
						logger.log('[loop -', data._doc_id_iter + ']', JSON.stringify(metrics, null, 2));
						data._skip_offset += MAX_STUBS_IN_MEMORY;
						data._since = last_sequence;
						data._doc_id_iter++;
						return millions_doc_loop(data, million_cb);					// recurse
					} else {
						logger.log('[phase 2] complete.', misc.friendly_ms(Date.now() - start), 'completed loops:', data._doc_id_iter + '/' + data.loops);
						return million_cb(errs);									// all done
					}
				});
			});
		}

		// phase 1 - get doc stubs (uses a stream)
		function phase1(data, phase_cb) {
			logger.log('[phase 1] starting...');
			data._since = data._since || 0;
			logger.log('[phase 1] starting since sequence:', data._since);
			iam_lib.add_progress();

			const req = {
				url: options._base_url + '/' + options.db_name + '/_changes',
				params: { style: 'main_only', seq_interval: MAX_STUBS_IN_MEMORY, limit: MAX_STUBS_IN_MEMORY, since: data._since },
				responseType: 'stream',
				method: 'get',
				timeout: 90000,
				headers: misc.build_headers(),
			};
			const s = new stream.PassThrough();
			axios(req).then((response) => {
				response.data.pipe(s);
			}).catch(response => {
				if (response.isAxiosError && response.response) {
					response = response.response;
				}
				const message = response.statusText;
				const error = new Error(message);
				error.statusCode = response.status || 500;
				error.name = 'Error';
				error.reason = message;
				s.emit('error', error);
			});
			s.on('end', () => {
				return phase_cb(null);
			});
			s.on('error', function (err) {
				logger.error('[phase 1] unable to read _changes feed. error:');
				logger.error(JSON.stringify(err, null, 2));
				db_errors.push(err);
				return phase_cb(err);
			});
			s.pipe(break_lines()).pipe(changes(handle_change_entry));
		}

		// phase 2 - get the docs & write to stream
		function phase2(data, phase_cb) {
			logger.log('[phase 2] starting...');
			const CL_MIN_READ_RATE = 100;										// the reading rate of cloudant's cheapest plan
			high_ms = 0;
			iam_lib.add_progress();

			// calc the number of batch apis we will send
			const get_doc_batch_size = data.batch_size || 1;
			let max_parallel_apis = options.max_parallel_reads || (Math.floor(options.max_rate_per_sec / get_doc_batch_size) * 2);
			if (max_parallel_apis < 1) {
				max_parallel_apis = 1;
			}
			logger.log('[phase 2] batch size:', get_doc_batch_size);
			logger.log('[phase 2] max parallel apis:', max_parallel_apis);
			logger.log('[phase 2] max doc per sec:', options.max_rate_per_sec);
			logger.log('[phase 2] min doc per sec:', options.min_rate_per_sec);
			logger.log('[phase 2] head room: ' + options.head_room_percent + '%');

			const head_room_dec = (100 - options.head_room_percent) / 100;
			logger.log('[phase 2] max doc per sec - head room:', Math.floor(options.max_rate_per_sec * head_room_dec));

			// start with a low rate, work our way up
			let starting_api_rate = Math.floor(CL_MIN_READ_RATE * ((100 - options.head_room_percent) / 100) / get_doc_batch_size);
			if (starting_api_rate < 1) {
				starting_api_rate = 1;
			}
			logger.log('[phase 2] starting apis rate  per sec:', starting_api_rate);

			async_options = {
				start: start,
				count: (data.batch_size === 0) ? 0 : Math.ceil(doc_stubs.length / data.batch_size),	// calc the number of batch apis we will send
				starting_rate_per_sec: starting_api_rate,						// start low, work way up
				max_rate_per_sec: options.max_rate_per_sec,
				min_rate_per_sec: options.min_rate_per_sec,
				max_parallel: max_parallel_apis,
				head_room_percent: options.head_room_percent,
				_pause: false,
				_all_stop: false,
				_reported_rate_modifier: data.batch_size,
				request_opts_builder: (iter) => {								// build the options for each batch couchdb api
					const start = (iter - 1) * data.batch_size;
					const end = start + data.batch_size;
					return {
						method: 'POST',
						baseUrl: options._base_url,
						url: '/' + options.db_name + '/_bulk_get',
						body: JSON.stringify({ docs: doc_stubs.slice(start, end) }),
						headers: misc.build_headers(),
						timeout: options.read_timeout_ms,
						_name: 'phase2',										// name to use in logs
					};
				}
			};
			async_rl.async_reqs_limit(async_options, (resp, req_cb) => {
				iam_lib.add_progress();
				handle_docs(resp);
				return req_cb();
			}, (errs) => {														// all done!
				if (errs) {
					logger.error('[phase 2] backup may not be complete. errors:');
					logger.error(JSON.stringify(errs, null, 2));
					db_errors.push(errs);
				}
				return phase_cb();
			});
		}

		// phase 3 - process any changes since we started the backup
		function phase3(data, phase_cb) {
			data._changes_iter = data._changes_iter || 1;						// init if needed
			logger.log('[phase 3] starting...');
			logger.log('[phase 3] i:', data._changes_iter, 'looking since sequence:', data.seq.substring(0, 16));
			iam_lib.add_progress();

			if (data._changes_iter >= 75) {
				logger.log('[phase 3] recursed on changes for too long. giving up.');
				return phase_cb();
			}

			const bulk_size = (isNaN(data.batch_size) || data.batch_size <= 0) ? 1 : data.batch_size;		// cannot set 0 or negative
			const opts = {
				db_name: options.db_name,
				query: '&since=' + data.seq + '&include_docs=true&limit=' + bulk_size + '&seq_interval=' + bulk_size
			};
			couch.get_changes(opts, (err, body) => {							// get the changes feed
				iam_lib.add_progress();
				if (err || !body.results) {
					logger.error('[phase 3] unable to get db changes. e:', err);
					db_errors.push(err);
					return phase_cb();
				}

				if (body.results.length === 0) {
					logger.log('[phase 3] 0 changes since backup start.');
					return phase_cb();
				} else {
					const docs = misc.parse_for_docs_changes(body);
					logger.log('[phase 3] parsing changes since backup start.', docs.length);
					finished_docs += docs.length;
					write_docs_2_stream(data._changes_iter, docs);

					if (docs.length !== bulk_size) {
						logger.log('[phase 3] all changes since backup start are processed.');
						return phase_cb();
					} else {
						data._changes_iter++;
						data.seq = body.last_seq;								// continue from here
						logger.log('[phase 3] last sequence:', body.last_seq);
						logger.log('[phase 3] there are more changes. getting next batch:', data._changes_iter);
						return phase3(data, phase_cb);
					}
				}
			});
		}

		// handle the docs in the couchdb responses - write the docs to the stream
		function handle_docs(response) {
			let body = response ? response.body : null;
			const api_id = response ? response.iter : 0;
			const doc_elapsed_ms = response ? response.elapsed_ms : 0;
			const docs = misc.parse_for_docs(body);

			if (doc_elapsed_ms > high_ms) {
				high_ms = doc_elapsed_ms;
			}

			if (body && body.error) {
				db_errors.push(body);
				if (misc.look_for_db_dne_err(body)) {
					logger.error('---- critical error ----');
					logger.error('[rec] ERROR response for api: ' + api_id + '. the db has had an untimely end!');
					logger.error('---- critical error ----');
					async_options._all_stop = true;
				}
			} else if (docs && docs.length > 0) {
				finished_docs += docs.length;					// keep track of the number of docs we have finished
				const percent_docs = finished_docs / num_all_db_docs * 100;
				logger.log('[rec] api response:', api_id + ', # docs:', docs.length + ', took:', misc.friendly_ms(doc_elapsed_ms) +
					', high:', misc.friendly_ms(high_ms) + ', fin docs:', misc.friendly_number(finished_docs), '[' + (percent_docs).toFixed(1) + '%]');
				predict_time_left(api_id, percent_docs);
				write_docs_2_stream(api_id, docs);
			}
		}

		// log much time is left for all loops to complete
		function predict_time_left(api_id, percent_all_db_docs_done) {
			if (api_id % 3 === 0) {											// only log this every now and then
				const job_elapsed_ms = Date.now() - start;
				const estimated_total_ms = (percent_all_db_docs_done === 0) ? 0 : (1 / (percent_all_db_docs_done / 100) * job_elapsed_ms);
				const time_left = (estimated_total_ms - job_elapsed_ms);
				logger.log('[estimates] total backup will take:', misc.friendly_ms(estimated_total_ms) + ', time left:', misc.friendly_ms(time_left));
			}
		}

		// write the docs to the write stream
		function write_docs_2_stream(api_id, docs_array) {
			const write_okay = options.write_stream.write(JSON.stringify(docs_array) + '\n', 'utf8', write_flushed);
			if (!write_okay) {												// the buffer is full, ALL STOP (wait for drain event)
				if (async_options._pause === false) {
					async_options._pause = true;
					options.write_stream.once('drain', function () {
						async_options._pause = false;						// put it back
					});
					//logger.log('[write] stalling couch reads b/c write stream is backed up');
				}
			}

			function write_flushed() {
				logger.log('[write] wrote docs from batch api:', api_id + ', # docs:', docs_array.length + ', total docs:', finished_docs);
			}
		}

		// handle each change feed entry
		function handle_change_entry(doc_change) {
			if (doc_change && doc_change.last_seq) {
				logger.log('[phase1] found the last sequence in change feed', doc_change.last_seq.substring(0, 16));	// need this for next loop
				last_sequence = doc_change.last_seq;
			}
			if (doc_change && !isNaN(doc_change.pending)) {
				logger.log('[phase1] found the pending changes field in change feed:', doc_change.pending, 'changes_this_loop:', changes_this_loop);
				pending_sequences = doc_change.pending;									// the sequences left doesn't appear in each entry, only the last
			}

			if (doc_change && doc_change.changes) {
				changes_this_loop++;
			}

			if (doc_change && doc_change.changes && !doc_change.deleted) {				// always skip deleted docs
				try {
					const last = doc_change.changes.length - 1;
					doc_stubs.push({ id: doc_change.id, rev: doc_change.changes[last].rev });
				} catch (e) { }

				if (doc_stubs.length % 10000 === 0) {									// print the status every so often
					logger.log('[rec] streaming changes, stubs: ' + doc_stubs.length + ', elapsed: ' + misc.friendly_ms(Date.now() - start) +
						', pending: ' + pending_sequences);
				}
			}
		}

		// ------------------------------------------------------
		// get initial db data to figure out the batch size
		// ------------------------------------------------------
		function get_db_data(data_cb) {
			const errs = [];
			logger.log('[stats] couchdb url: ' + misc.get_base_url(options.couchdb_url, true));
			async.parallel([

				// ---- Get basic db data ---- //
				(join) => {
					couch.get_db_data({ db_name: options.db_name }, (err, resp) => {				// first get the db data for the doc count
						if (err) {
							errs.push(err);
							logger.error('[stats] unable to get basic db data. e:', err);
						}
						return join(null, resp);
					});
				},

				// ---- Get _change sequence ---- //
				(join) => {
					couch.get_changes({ db_name: options.db_name, query: '&since=now' }, (err, resp) => {	// get the changes feed and grab the last seq
						if (err) {
							errs.push(err);
							logger.error('[stats] unable to get db changes. e:', err);
						}
						return join(null, resp);
					});
				}

			], (_, resp) => {
				if (errs.length > 0) {
					// already logged
					return data_cb(errs, null);
				} else if (!resp || !resp[0] || !resp[1]) {
					logger.error('[stats] missing db stat data to do backup');
					errs.push({ error: 'missing db stat data to do backup' });
					return data_cb(errs, null);
				} else {
					const resp1 = resp[0];
					const avg_doc_bytes = (resp1.doc_count === 0) ? 0 : resp1.sizes.external / resp1.doc_count;
					const batch_size = (avg_doc_bytes === 0) ? 0 : Math.floor(options.batch_get_bytes_goal / avg_doc_bytes);
					const doc_count = resp1.doc_count;
					const del_count = resp1.doc_del_count;
					const seq = resp[1].last_seq;
					const loops = Math.ceil((doc_count + del_count) / MAX_STUBS_IN_MEMORY);			// phase1 loops over deleted and active docs
					logger.log('[stats] db:', options.db_name);
					logger.log('[stats] size:', misc.friendly_bytes(resp1.sizes.external));
					logger.log('[stats] docs:', misc.friendly_number(doc_count));
					logger.log('[stats] avg doc:', misc.friendly_bytes(avg_doc_bytes));
					logger.log('[stats] batch size:', batch_size);
					logger.log('[stats] deleted docs:', misc.friendly_number(del_count), '-', (del_count / (del_count + doc_count) * 100).toFixed(1) + '%');
					logger.log('[stats] # phase loops:', loops);
					return data_cb(null, { batch_size, seq, doc_count, loops });					// pass the data we need on
				}
			});
		}

		// ------------------------------------------------------
		// end the backup - flush the write stream
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
