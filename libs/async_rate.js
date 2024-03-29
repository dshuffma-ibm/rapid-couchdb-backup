//------------------------------------------------------------
// async_rate.js
//------------------------------------------------------------
module.exports = function (logger) {
	const exports = {};
	const async = require('async');
	const request = require('request');
	const misc = require('./misc.js')();

	// run http request up to an unknown rate limit
	/*
	{
		count: 100,							// number of http requests we will be sending in total (not in parallel)
		max_rate_per_sec: 50,				// the maximum number of api requests to send per second (upper bound)
		max_parallel: 10,					// [optional] how many pending apis can there ever be
		head_room_percent: 20,				// [optional]
		min_rate_per_sec: 2,				// [optional]
		starting_rate_per_sec: 2,			// [optional]
		start: 0,
		request_opts_builder: (iter)=> {}	// function to build the http request options
		_pause: false,						// if true, apis will stop being sent, stall
		_all_stop: false,					// if true, the apis will stop being sent and the cb will be fired
	}
	*/
	// min rates in cloudant:
	// - 5 global req/sec
	// - 100 reads/sec
	exports.async_reqs_limit = (options, request_cb, finish_cb) => {
		const start = options.start || Date.now();
		let on = 0;
		let ids = {};
		let pending_ids = {};
		let allow_decrease = true;
		let limit_hit = false;
		let allow_increase = true;
		let CURRENT_LIMIT_PER_SEC = options.starting_rate_per_sec || 2;	// start off at 2, increase from here
		let detected_max_rate_per_sec = 0;
		const stalled_ids = {};
		let log_interval = null;
		let http_errors = [];
		let timer1, timer2, timer3;

		// --------------------------------------------
		// first setup a progress logger - do this first b/c w/o we may hit the launcher callback before the interval was created and then it won't be cleared
		// --------------------------------------------
		log_interval = setInterval(() => {
			clean_up_records();
			const elapsed_ms = Date.now() - start;
			const detected_max_docs_per_sec = !detected_max_rate_per_sec ? '*' : (detected_max_rate_per_sec * options._reported_rate_modifier);
			const curr_docs_per_sec_limit = Object.keys(ids).length * options._reported_rate_modifier;
			logger.log('- running for: ' + misc.friendly_ms(elapsed_ms) + ', stalled apis:', Object.keys(stalled_ids).length + ', pending apis:',
				Object.keys(pending_ids).length + ', current read rate:', curr_docs_per_sec_limit + '/sec, max reads:', detected_max_docs_per_sec + '/sec');
		}, 10 * 1000);

		// --------------------------------------------
		// go
		// --------------------------------------------
		const requests = [];											// build a dummy array, 1 per request we expect to do
		for (let i = 1; i <= options.count; i++) {
			requests.push(i);
		}
		logger.log('[launcher] starting', requests.length, 'batch doc reqs. max parallel:', options.max_parallel);
		launcher(requests, options, request_cb, () => {
			clearInterval(log_interval);
			clearTimeout(timer1);
			clearTimeout(timer2);
			clearTimeout(timer3);
			if (http_errors.length > 0) {
				logger.error('[fin] there were http errors. :(\n', http_errors);
				return finish_cb(http_errors);
			} else {
				logger.log('[fin] there were 0 http errors. :)');
				return finish_cb(null);
			}
		});

		// --------------------------------------------
		// spin up async requests as fast as possible but backoff once a 429 is reached
		// --------------------------------------------
		function launcher(things, options, req_cb, fin_cb) {
			async.eachLimit(things, options.max_parallel, (thing, cb) => {
				stall_api(thing, () => {
					if (options._all_stop === true) {										// end this thing already
						logger.error('[spawn] ALL STOP');
						return cb();
					}

					const id = ++on;
					record_api(id);
					const apis_per_sec = Object.keys(ids).length;
					const req_options = options.request_opts_builder(id);
					req_options._tx_id = id;

					options._reported_rate_modifier = options._reported_rate_modifier || 1;
					const at_docs_per_sec = apis_per_sec * options._reported_rate_modifier;
					const curr_docs_per_sec_limit = CURRENT_LIMIT_PER_SEC * options._reported_rate_modifier;
					const detected_max_docs_per_sec = !detected_max_rate_per_sec ? '*' : (detected_max_rate_per_sec * options._reported_rate_modifier);

					const percent_sent = (options.count === 0) ? 0 : (on / options.count * 100);
					logger.log('[spawn] sending api', on + ', @ doc read rate:', at_docs_per_sec + '/sec, batch size:', options._reported_rate_modifier +
						', reqs sent:', percent_sent.toFixed(1) + '%');
					logger.log('\tlimiting doc reads to:', curr_docs_per_sec_limit + '/sec, detected max rate of:', detected_max_docs_per_sec + '/sec');

					retry_req(JSON.parse(JSON.stringify(req_options)), thing, (err, resp) => {
						if (err) {
							logger.error('[spawn] connection error:\n', err);
							http_errors.push(err);

							if (options._all_stop === true) {								// end this thing already
								logger.error('[spawn] ALL STOP');
								return cb();
							}
						}

						remove_api(id);
						stall_loop(() => {													// stall the request cb if we are paused
							const ret = {
								body: (resp && resp.body) ? parse_json(resp) : null,
								iter: id,
								elapsed_ms: (resp && resp.headers) ? resp.headers._elapsed_ms : 0
							};
							req_cb(ret, () => {
								return cb();
							});
						});
					});
				});
			}, () => {
				const elapsed = Date.now() - start;
				logger.log('[spawn] launcher finished:', misc.friendly_ms(elapsed));
				return fin_cb();
			});
		}

		// --------------------------------------------
		// lower the rate limit (but debounce it to avoid crashing the rate limit)
		// --------------------------------------------
		function decrease_rate_limit() {
			if (allow_decrease === true) {
				allow_decrease = false;
				limit_hit = true;
				const current_rate_per_sec = Object.keys(ids).length;
				const prev_limit = CURRENT_LIMIT_PER_SEC;
				detected_max_rate_per_sec = current_rate_per_sec;			// this is likely the official rate limit, store it for logs
				CURRENT_LIMIT_PER_SEC = Math.floor((current_rate_per_sec - 1) * ((100 - options.head_room_percent) / 100));

				if (CURRENT_LIMIT_PER_SEC >= prev_limit) {		// if the new "decreased" limit is greater than old one... forget it, decrement old one instead
					CURRENT_LIMIT_PER_SEC = prev_limit * 0.8;
				}

				if (CURRENT_LIMIT_PER_SEC * options._reported_rate_modifier < options.min_rate_per_sec) {	// only let it go so low
					CURRENT_LIMIT_PER_SEC = Math.floor(options.min_rate_per_sec / options._reported_rate_modifier);
					if (CURRENT_LIMIT_PER_SEC < 1) {
						CURRENT_LIMIT_PER_SEC = 1;
					}
				}

				// this shouldn't happen... but just incase don't let the new limit be higher than max rate limit
				const head_room_dec = (100 - options.head_room_percent) / 100;
				if ((CURRENT_LIMIT_PER_SEC * options._reported_rate_modifier) > (options.max_rate_per_sec * head_room_dec)) {
					CURRENT_LIMIT_PER_SEC = Math.ceil(options.max_rate_per_sec * head_room_dec / options._reported_rate_modifier);
				}

				options._reported_rate_modifier = options._reported_rate_modifier || 1;
				const curr_docs_per_sec_limit = CURRENT_LIMIT_PER_SEC * options._reported_rate_modifier;
				const detected_max_docs_per_sec = !detected_max_rate_per_sec ? '*' : (detected_max_rate_per_sec * options._reported_rate_modifier);
				const prev_max_docs_per_sec = prev_limit * options._reported_rate_modifier;
				if (prev_limit === CURRENT_LIMIT_PER_SEC) {
					logger.log('\n\n[CODE 429] Unable to decrease rate limit, the settings will not allow it to go lower. detected doc max:',
						detected_max_docs_per_sec, 'api limit: ', CURRENT_LIMIT_PER_SEC, '\n');
				} else {
					logger.log('\n\n[CODE 429] Decreasing doc rate limit to:', curr_docs_per_sec_limit + ', detected doc max:', detected_max_docs_per_sec +
						', prev doc limit:', prev_max_docs_per_sec, 'api limit:', CURRENT_LIMIT_PER_SEC, '\n');
				}
				timer1 = setTimeout(() => {
					allow_decrease = true;									// allow decrease to happen again (few seconds)
				}, 1000 * 10);

				timer2 = setTimeout(() => {
					limit_hit = false;										// allow increase to happen again (many minutes)
				}, 1000 * 60 * 15);
			}
		}

		// only start api if we are under the desired rate limit - RECURSIVE!
		function stall_api(id, end_stall_cb) {
			clean_up_records();
			if (options._all_stop === true) {							// do not stall, end everything
				delete stalled_ids[id];
				return end_stall_cb();
			} else if (under_desired_rate_limit()) {
				delete stalled_ids[id];
				return end_stall_cb();
			} else {
				setTimeout(() => {
					stalled_ids[id] = true;
					return stall_api(id, end_stall_cb);						// postpone again - recurse
				}, 200);
			}
		}

		// see if we are at the rate limit or not
		function under_desired_rate_limit() {
			if (options._pause === true) {									// stall them all if we need to pause, back pressure
				return false;
			} else {
				return Object.keys(ids).length < CURRENT_LIMIT_PER_SEC;
			}
		}

		// record when this api was launched
		function record_api(id) {
			ids[id] = Date.now();
			pending_ids[id] = true;
		}

		// remove record of this api
		function remove_api(id) {
			delete ids[id];
			delete pending_ids[id];
		}

		// remove api records that are older than 1 second
		function clean_up_records() {
			for (let key in ids) {
				const elapsed = Date.now() - ids[key];
				if (elapsed > 1000) {
					delete ids[key];
				}
			}
		}

		// ------------------------------------------------------------
		// wrapper on request module - does retries on some error codes
		// -------------------------------------------------------------
		/*
			opts: {
				// normal http "request" options go here
				baseUrl: '',

				... // etc

				// req name to print in logs
				// defaults to 'request'
				_name: 'component lib',

				// id of the transaction
				_tx_id: 2,

				// maximum number of requests to send
				// defaults to 3
				_max_attempts: 3,
			}
		*/
		function retry_req(opts, thing, cb) {
			opts._name = opts._name || 'request';										// name for request type, for debugging
			opts._max_attempts = opts._max_attempts || 3;								// only try so many times
			opts._retry_codes = opts._retry_codes || {									// list of codes we will retry
				'429': '429 rate limit',
				'408': '408 timeout',
				'500': '500 internal error',
			};
			opts._attempt = opts._attempt || 0;
			opts._attempt++;
			const start_ts = Date.now();

			// --- Send the Request --- //
			request(opts, (req_e, resp) => {
				if (req_e) {																// detect timeout request error
					resp = resp ? resp : {};												// init if not already present
					resp.statusCode = resp.statusCode ? resp.statusCode : 500;				// init code if empty
					resp.body = resp.body ? resp.body : req_e;								// copy requests error to resp if its empty
					if (req_e.toString().indexOf('TIMEDOUT') >= 0) {
						logger.error('! [' + opts._name + ' ' + opts._tx_id + '] failed - timeout exceeded:', opts.timeout);
						resp.statusCode = 408;
					} else {
						logger.error('! [' + opts._name + ' ' + opts._tx_id + '] failed - unable to reach destination. error:', req_e);
					}
				}

				// add how long it took
				if (resp && resp.headers) {
					resp.headers._elapsed_ms = Date.now() - start_ts;
				}

				// adjust rate limit based on error code
				const code = misc.get_code(resp);
				let increasing_limit = false;
				const curr_docs_per_sec_limit = CURRENT_LIMIT_PER_SEC * options._reported_rate_modifier;
				if (code === 429) {
					decrease_rate_limit();
				} else if (limit_hit === false && curr_docs_per_sec_limit < options.max_rate_per_sec) {
					if (allow_increase === true) {		 // no need to increase each time, do it slower to avoid congestion
						CURRENT_LIMIT_PER_SEC += 1;
						increasing_limit = true;
						allow_increase = false;
						timer3 = setTimeout(() => {
							allow_increase = true;		// allow increase to happen again (several seconds)
						}, 1000 * 20);
					}
				}

				// never go higher than what was provided in the input args for the max rate
				const head_room_dec = (100 - options.head_room_percent) / 100;
				if (curr_docs_per_sec_limit > (options.max_rate_per_sec * head_room_dec)) {
					CURRENT_LIMIT_PER_SEC = Math.floor(options.max_rate_per_sec * head_room_dec / options._reported_rate_modifier);
					if (CURRENT_LIMIT_PER_SEC * options._reported_rate_modifier < options.min_rate_per_sec) {	// only let it go so low
						CURRENT_LIMIT_PER_SEC = Math.floor(options.min_rate_per_sec / options._reported_rate_modifier);
					}
					if (CURRENT_LIMIT_PER_SEC < 1) {
						CURRENT_LIMIT_PER_SEC = 1;
					}
				}

				if (increasing_limit) {
					const new_docs_per_sec_limit = CURRENT_LIMIT_PER_SEC * options._reported_rate_modifier;
					logger.log('\n\nIncreasing rate limit', new_docs_per_sec_limit, '\n');
				}

				// retry logic
				if (misc.is_error_code(code)) {
					const code_desc = opts._retry_codes[code.toString()];
					if (code_desc) {															// retry on these error codes
						if (code !== 429 && opts._attempt >= opts._max_attempts) {				// don't give up on 429s, retry it again
							logger.error('[' + opts._name + ' ' + opts._tx_id + '] ' + code_desc + ', giving up. attempts:', opts._attempt);
							return cb(req_e, resp);
						} else {
							const delay_ms = calc_delay(opts, resp);
							logger.error('[' + opts._name + ' ' + opts._tx_id + '] ' + code_desc + ', trying again in a bit:', misc.friendly_ms(delay_ms));
							return setTimeout(() => {
								stall_api(thing, () => {
									record_api(opts._tx_id);
									return retry_req(opts, thing, cb);							// try the request again after a delay
								});
							}, delay_ms);
						}
					}
				}
				return cb(req_e, resp);															// return final error or success
			});

			// calculate the delay to send the next request (in ms) - (_attempt is the number of the attempt that failed)
			function calc_delay(opt, resp) {
				const code = misc.get_code(resp);
				opt._delay_ms = !isNaN(opt._delay_ms) ? opt._delay_ms : (500 + Math.random() * 1500);	// small delay, large randomness to stagger reqs
				if (code === 429) {																// on 429 codes stager delay exponential
					opt._delay_ms *= 2;
				} else {																		// on other codes stager delay w/large randomness
					opt._delay_ms = ((500 * opt._attempt) + Math.random() * 1500);
				}
				if (opt._delay_ms >= 60 * 1000) {										 		// don't delay for over 1 minute
					opt._delay_ms = 60 * 1000;
				}
				return opt._delay_ms.toFixed(0);
			}
		}

		// don't respond if we are paused
		function stall_loop(stall_cb) {
			if (options._all_stop === true) {													// do not stall, end everything
				return stall_cb();
			} else if (options._pause === false) {
				return stall_cb();
			} else {
				logger.log('[rec] paused.');
				setTimeout(() => {
					return stall_loop(stall_cb);												// postpone again - recurse
				}, 500);
			}
		}
	};

	// --------------------------------------------
	// parse api response to json
	// --------------------------------------------
	function parse_json(response) {
		let json = {};
		try {
			json = JSON.parse(response.body);
		} catch (e) {
			//logger.error('unable to parse response to json:', e);
		}
		return json;
	}

	return exports;
};
