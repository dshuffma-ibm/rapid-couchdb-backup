//=======================================================================================================
// IAM Library
//=======================================================================================================
/* eslint no-bitwise: 0 */

module.exports = (logger) => {
	const iam = {};
	const request = require('request');
	const misc = require('./misc.js')();
	const REFRESH_OFFSET_S = 300;
	const IAM_TOKEN_URL = process.env.IAM_TOKEN_URL || 'https://identity-3.us-south.iam.cloud.ibm.com/identity/token';
	const iam_timeouts = {};
	const stopping_timeouts = {};
	let progress = Date.now();
	let watch_dog = null;
	start_watch_dog();

	// --------------------------------------------------------------------------------------------
	// convert an IAM api key for an IAM access token
	// --------------------------------------------------------------------------------------------
	/*
	options: {
		iam_apikey: ''
	}
	*/
	iam.get_iam_key = (options, cb) => {
		logger.info('[iam] exchanging iam api key for token. ' + Date.now() + ', id: ' + censored_key(options.iam_apikey));
		clearTimeout(iam_timeouts[options.iam_apikey]);							// clear past ones, only need 1 per key
		iam_timeouts[options.iam_apikey] = null;

		const opts = {
			url: IAM_TOKEN_URL,
			api_key: options.iam_apikey,
		};
		iam.getAccessTokenHttp(opts, (err, response) => {
			// error already logged

			if (response && response.access_token) {
				process.env.IAM_ACCESS_TOKEN = response.access_token;			// store it here...
				const expires_in_s = response.expires_in;
				const refresh_ms = 1000 * (expires_in_s - REFRESH_OFFSET_S);	// refresh it 5 minutes before expiration
				logger.info('[iam] stored iam access token. will expire in: ' + misc.friendly_ms(1000 * expires_in_s));

				// since this is recursive and async it is possible to leave a timeout running w/o this stopping check.
				// it can happen if the "stop" comes in between the start and finish of this api.
				if (!stopping_timeouts[options.iam_apikey]) {					// if we are stopping, do not create another timer
					logger.info('[iam] refresh timer created. will refresh in: ' + misc.friendly_ms(refresh_ms) +
						', id: ' + censored_key(options.iam_apikey));
					iam_timeouts[options.iam_apikey] = setTimeout(() => {
						logger.info('[iam] token expires in: ' + misc.friendly_ms(iam.get_time_left(options.iam_apikey)) +
							', refreshing now. id: ' + censored_key(options.iam_apikey));
						iam.get_iam_key(options, () => { });
					}, refresh_ms);												// refresh the token before it expires
					iam_timeouts[options.iam_apikey]._started = Date.now();
				}
			} else {
				if (!stopping_timeouts[options.iam_apikey]) {					// if we are stopping, do not create another timer
					const refresh_ms = 30 * 1000;
					logger.info('[iam] *retry* refresh timer created. will refresh in: ' + misc.friendly_ms(refresh_ms) +
						', id: ' + censored_key(options.iam_apikey));
					iam_timeouts[options.iam_apikey] = setTimeout(() => {		// make retry timer
						logger.info('[iam] token expires in: ' + misc.friendly_ms(iam.get_time_left(options.iam_apikey)) +
							', refreshing now. id: ' + censored_key(options.iam_apikey));
						iam.get_iam_key(options, () => { });
					}, refresh_ms);												// refresh the token before it expires
				}
			}

			return cb(err, response ? response.access_token : null);
		});
	};

	// --------------------------------------------------------------------------------------------
	// reset the internal things for the access token refresh
	// --------------------------------------------------------------------------------------------
	iam.prepare_refresh = (apikey) => {
		logger.info('[iam] init-ing the iam refresh timeout, id: ' + censored_key(apikey));
		stopping_timeouts[apikey] = false;
		clearTimeout(iam_timeouts[apikey]);
		iam_timeouts[apikey] = null;
	};

	// --------------------------------------------------------------------------------------------
	// stop the access token refresh timer
	// --------------------------------------------------------------------------------------------
	iam.stop_refresh = (apikey) => {
		logger.info('[iam] clearing iam refresh timeout, id: ' + censored_key(apikey));
		stopping_timeouts[apikey] = true;						// set this to catch a pending iam-key-exchange api from continuing forever
		clearTimeout(iam_timeouts[apikey]);
		iam_timeouts[apikey] = null;							// set to null so we can tell its stopped
	};

	// --------------------------------------------------------------------------------------------
	/* Exchange your api key for an identity access token - [http only, no cache]
	opts: {
		url: "https://hostname.com:port"
		api_key: "<base 64 jwt here>",
	}
	// --------------------------------------------------------------------------------------------*/
	iam.getAccessTokenHttp = (opts, cb) => {
		const options = {
			url: opts.url,
			body: 'grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=' + opts.api_key,
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			timeout: 60000,
		};
		request(options, (err, resp) => {							// adding retry b/c intermittent dns issues
			let ret = format_body('iam_access_token', resp);
			const code = misc.get_code(resp);
			if (misc.is_error_code(code) || !ret) {
				logger.error('[iam] req error getting access token. http error:', err, ', http resp:', (resp ? resp.body : null));
				return cb(err, ret);
			} else {
				return cb(err, ret);
			}
		});
	};

	// --------------------------------------------------------------------------------------------
	// get the time left on the latest access key (in ms)
	// --------------------------------------------------------------------------------------------
	iam.get_time_left = (iam_apikey) => {
		const timeout = iam_timeouts[iam_apikey];
		if (timeout && timeout._started) {
			return timeout._idleTimeout - (Date.now() - timeout._started) + (REFRESH_OFFSET_S * 1000);
		} else {
			return 0;
		}
	};

	// --------------------------------------------------------------------------------------------
	// indicate that progress is still occurring
	// --------------------------------------------------------------------------------------------
	iam.add_progress = () => {
		progress = Date.now();						// update the time
	};

	// --------------------------------------------------------------------------------------------
	// check if all timers have ended
	// --------------------------------------------------------------------------------------------
	iam.safe_kill_watch_dog = () => {
		let ending = true;							// default
		for (let key in iam_timeouts) {
			if (iam_timeouts[key]) {				// if any exist, wait for it to end or the watch dog to trip
				ending = false;
			}
		}
		if (ending) {
			kill_watch_dog();						// if we are ending we can kill our watch dog
		}
	};

	// --------------------------------------------------------------------------------------------
	// end the watch dog interval
	// --------------------------------------------------------------------------------------------
	function kill_watch_dog() {
		kill_timers();
		clearInterval(watch_dog);					// die
		logger.debug('[iam] ended watch dog.');
	}

	// --------------------------------------------------------------------------------------------
	// end all timers
	// --------------------------------------------------------------------------------------------
	function kill_timers() {
		logger.debug('[iam] ending all timers. ' + Object.keys(iam_timeouts).length);
		for (let key in iam_timeouts) {
			if (iam_timeouts[key]) {
				iam.stop_refresh(key);				// end each
			}
		}
	}

	// safe guard - after xxx minutes have elapsed with no progress kill all timers/intervals.
	function start_watch_dog() {
		clearInterval(watch_dog);					// only need 1, kill others
		watch_dog = setInterval(() => {
			const MAX_STUCK_TIME_MIN = 20;
			const elapsed = Date.now() - progress;
			logger.debug('[iam] watch dog, last progress mins ago: ' + misc.friendly_ms(elapsed));

			if (elapsed >= 1000 * 60 * MAX_STUCK_TIME_MIN) {
				logger.error('[iam] watch dog timeout, ending all timers.');
				kill_watch_dog();
			}
		}, 1000 * 60 * 6);							// check every few minutes
	}

	// return null if we cannot parse response
	function format_body(tx_id, resp) {
		let body = null;
		if (resp && resp.body) {					// parse body to JSON
			body = resp.body;
			try { body = JSON.parse(resp.body); }
			catch (e) {
				logger.error('[iam] could not format response body as JSON', tx_id, e);
				return null;
			}
		}
		return body;
	}

	// return part of the key to id it
	function censored_key(api_key) {
		if (typeof api_key !== 'string') {
			return '-';
		} else {
			return hash_str(api_key).substring(0, 8);
		}

		// hash a str [same as Java's string.hashCode()]
		function hash_str(str) {
			let hash = 0;
			for (const i in str) {
				const char = str.charCodeAt(i);
				hash = ((hash << 5) - hash) + char;
				hash = hash & hash;
			}
			return hash.toString(16);
		}
	}

	return iam;
};
