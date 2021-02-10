//------------------------------------------------------------
// async_rate.js
//------------------------------------------------------------
module.exports = function () {
	const exports = {};
	const async = require('async');
	const request = require('request');
	const misc = require('./misc.js')();

	// run http request up to an unknown rate limit
	/*
	{
		count: 100,							// number of http requests we will be sending
		max_rate_per_sec: 50,				// the maximum number of api requests to send per second (upper bound)
		max_parallel: 1000,					// this can be really high, ideally the rate limiter is controlling the load, not this field
		head_room_percent: 80,				// how much of the real rate limit should be used for this task (80 -> 80% of the detected rate limit)
		request_opts_builder: (iter)=> {}	// function to build the http request options
		min_rate_per_sec: 2,
	}
	*/
	// dsh todo protect input options
	exports.async_reqs_limit = (options, request_cb, finish_cb) => {
		const start = Date.now();
		let on = 0;
		let ids = {};
		let pending_ids = {};
		let allow_decrease = true;
		let limit_hit = false;
		let CURRENT_LIMIT_PER_SEC = 0;
		let detected_max_rate_per_sec = 0;
		const stalled_ids = {};

		const requests = [];										// build a dummy array, 1 per request we expect to do
		for (let i = 1; i <= options.count; i++) {
			requests.push(i);
		}
		console.log('starting', requests.length, 'batch doc reqs. max parallel:', options.max_parallel);
		options.min_rate_per_sec = options.min_rate_per_sec || 2;
		CURRENT_LIMIT_PER_SEC = 2;									// start off at 2, increase from here
		launcher(requests, options, request_cb, () => {
			return finish_cb();
		});

		setInterval(() => {
			clean_up_records();
			const elapsed_ms = Date.now() - start;
			console.log('- running for: ' + misc.friendly_ms(elapsed_ms) + ', stalled apis:', Object.keys(stalled_ids).length + ', pending apis:', Object.keys(pending_ids).length + ', current rate:', Object.keys(ids).length + '/sec, max:', detected_max_rate_per_sec + '/sec');
		}, 1 * 1000);

		// spin up aysnc requests as fast as possible but backoff once a 429 is reached
		function launcher(things, options, req_cb, fin_cb) {
			async.eachLimit(things, options.max_parallel, (thing, cb) => {
				stall_api(thing, () => {
					const id = ++on;
					clean_up_records();
					record_api(id);
					const apis_per_sec = Object.keys(ids).length;
					const req_options = options.request_opts_builder(id);
					req_options._tx_id = id;
					req_options._max_rate_per_sec = options.max_rate_per_sec;

					const elapsed_ms = Date.now() - start;
					const percent = on / options.count * 100;
					const estimated_total_ms = 1 / (percent / 100) * elapsed_ms;
					const time_left = estimated_total_ms - elapsed_ms;

					console.log('[spawn] sending api', on + ', @ rate:', apis_per_sec + '/sec limit:', CURRENT_LIMIT_PER_SEC + '/sec, detected max:', detected_max_rate_per_sec + '/sec, reqs sent:', percent.toFixed(1) + '%');
					console.log('[spawn] estimated time:', misc.friendly_ms(estimated_total_ms), 'time left:', misc.friendly_ms(time_left), confidence(percent));

					retry_req(JSON.parse(JSON.stringify(req_options)), (err, resp) => {
						// dsh todo handle connection errors
						remove_api(id);
						const ret = {
							body: parse_json(resp),
							iter: id,
							elapsed_ms: (resp && resp.headers) ? resp.headers._elapsed_ms : 0
						};
						req_cb(ret, () => {
							return cb();
						});
					});
				})
			}, () => {
				const end = Date.now();
				const elapsed = end - start;
				console.log('launcher finished:', elapsed);
				return fin_cb();
			});
		}

		// lower the rate limit (but debounce it to avoid crashing the rate limit)
		function decrease_rate_limit() {
			if (allow_decrease === true) {
				allow_decrease = false;
				limit_hit = true;
				const current_rate_per_sec = Object.keys(ids).length;
				const prev_limit = CURRENT_LIMIT_PER_SEC;
				detected_max_rate_per_sec = current_rate_per_sec;		// this is likely the official rate limit, store it for logs
				CURRENT_LIMIT_PER_SEC = Math.floor(current_rate_per_sec * (options.head_room_percent / 100));

				if (CURRENT_LIMIT_PER_SEC >= prev_limit) {				// if the new "decrease" is greater than the old one... forget it, decrement the old one instead
					CURRENT_LIMIT_PER_SEC = prev_limit - 1;
				}

				if (CURRENT_LIMIT_PER_SEC < options.min_rate_per_sec) {		// only let it go so low
					CURRENT_LIMIT_PER_SEC = options.min_rate_per_sec;
				}

				console.log('\n\nDECREASING RATE LIMIT to:', CURRENT_LIMIT_PER_SEC + ', detected max:', detected_max_rate_per_sec + ', prev limit:', prev_limit, '\n\n');
				setTimeout(() => {
					allow_decrease = true;									// allow decreae to happen again (few seconds)
				}, 1000 * 5);

				setTimeout(() => {
					limit_hit = false;										// allow increase to happen again (many minutes)
				}, 1000 * 60 * 60);
			}
		}

		// only start api if we are under the desired rate limit - RECURSIVE!
		function stall_api(id, end_stall_cb) {
			setTimeout(() => {
				if (under_desired_rate_limit(CURRENT_LIMIT_PER_SEC)) {
					delete stalled_ids[id];
					return end_stall_cb();
				} else {
					stalled_ids[id] = true;
					return stall_api(id, end_stall_cb);						// postpone again - recurse
				}
			}, 100);
		}

		// see if we are at the rate limit or not
		function under_desired_rate_limit(limit) {
			return Object.keys(ids).length < limit;
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
					//console.log('! removing api:', key, elapsed)
					delete ids[key];
				}
			}
		}

		// how likely is the time estimate - more likely the longer we run
		function confidence(per) {
			if (per >= 75) {
				return '(very high confidence in estimate)';
			} else if (per >= 50) {
				return '(high confidence in estimate)';
			} else if (per >= 2) {
				return '(low confidence in estimate)';
			} else {
				return '(no confidence in estimate)';
			}
		}

		// ------------------------------------------------------------
		// wrapper on request module - does retries on some error codes
		// -------------------------------------------------------------
		/*
			options: {
				// normal request options go here
				baseUrl: '',

				... //etc

				// req name to print in logs
				// defaults to 'request'
				_name: 'component lib',

				// maximum number of requests to send
				// defaults to 3
				_max_attempts: 3,

				// object of codes that should be retried.
				// if a code occurs that is not in this object it will not be retired. its error will be returned.
				// defaults to 429, 408, & 500 codes.
				_retry_codes: { '408' : 'description of code'},

				// if provided will use this function to calculate the delay between this failure and the next retry, ms
				_calc_retry_delay: (options, resp) => {
					return (1000 * options._attempt + (Math.random() * 2000)).toFixed(0);
				},

				// if provided will use this function to calculate the timeout of the next retry, ms
				_calc_retry_timeout: (options, resp) => {
					return Number(options.timeout) + 10000 * (options._attempt + 1);
				}
			}

		*/
		function retry_req(options, cb) {
			options._name = options._name || 'request';										// name for request type, for debugging
			options._max_attempts = options._max_attempts || 3;								// only try so many times
			options._retry_codes = options._retry_codes || {								// list of codes we will retry
				'429': '429 rate limit',
				'408': '408 timeout',
				'500': '500 internal error',
			};
			options._attempt = options._attempt || 0;
			options._attempt++;
			const start_ts = Date.now();

			// --- Send the Request --- //
			request(options, (req_e, resp) => {
				if (req_e) {																// detect timeout request error
					console.error('[' + options._name + ' ' + options._tx_id + '] unable to reach destination. error:', req_e);
					resp = resp ? resp : {};												// init if not already present
					resp.statusCode = resp.statusCode ? resp.statusCode : 500;				// init code if empty
					resp.body = resp.body ? resp.body : req_e;								// copy requests error to resp if its empty
					if (req_e.toString().indexOf('TIMEDOUT') >= 0) {
						console.error('[' + options._name + ' ' + options._tx_id + '] timeout exceeded:', options.timeout);
						resp.statusCode = 408;
					}
				}

				if (resp && resp.headers) {
					resp.headers._elapsed_ms = Date.now() - start_ts;
				}

				// adjust rate limit
				const code = misc.get_code(resp);
				if (code === 429) {
					decrease_rate_limit();
				}
				if (limit_hit === false && CURRENT_LIMIT_PER_SEC < options._max_rate_per_sec) {
					if (Number(options._tx_id) % 5) {		 // no need to increase each time, do it slower to avoid congestion
						CURRENT_LIMIT_PER_SEC += 1;
					}
				}

				// retry logic
				if (misc.is_error_code(code)) {
					const code_desc = options._retry_codes[code.toString()];
					if (code_desc) {															// retry on these error codes
						if (code !== 429 && options._attempt >= options._max_attempts) {		// don't give up on 429s, retry it again
							console.error('[' + options._name + ' ' + options._tx_id + '] ' + code_desc + ', giving up. attempts:', options._attempt);
							return cb(req_e, resp);
						} else {
							let delay_ms = calc_delay(options, resp);
							console.error('[' + options._name + ' ' + options._tx_id + '] ' + code_desc + ', trying again in a bit:', misc.friendly_ms(delay_ms));
							return setTimeout(() => {
								//console.error('[' + options._name + ' ' + options._tx_id + '] sending retry for prev ' + code + ' error.', options._attempt);
								return retry_req(options, cb);
							}, delay_ms);
						}
					}
				}
				return cb(req_e, resp);															// return final error or success
			});

			// calculate the delay to send the next request (in ms) - (_attempt is the number of the attempt that failed)
			function calc_delay(options, resp) {
				const code = misc.get_code(resp);
				options._delay_ms = !isNaN(options._delay_ms) ? options._delay_ms : (250 + Math.random() * 200);	// small delay, little randomness to stagger reqs
				if (code === 429) {																// on 429 codes stager delay exponential
					options._delay_ms *= 1.75;
				} else {																		// on other codes stager delay w/large randomness
					options._delay_ms = ((500 * options._attempt) + Math.random() * 1500);
				}
				if (options._delay_ms >= 60 * 1000) {										 	// don't delay for over 1 minute
					options._delay_ms = 60 * 1000;
				}
				return options._delay_ms.toFixed(0);
			}
		};
	}

	// parse api response to json
	function parse_json(response) {
		let json = {};
		try {
			json = JSON.parse(response.body);
		} catch (e) {
			console.error('unable to parse response to json:', e);
		}
		return json;
	}

	return exports;
};
