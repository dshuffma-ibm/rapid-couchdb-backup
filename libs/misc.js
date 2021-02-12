//------------------------------------------------------------
// misc.js
//------------------------------------------------------------
module.exports = function () {
	const exports = {};

	//------------------------------------------------------------
	// get http code from http response
	//------------------------------------------------------------
	exports.get_code = (obj) => {
		if (obj && obj.statusCode && !isNaN(obj.statusCode)) {
			return Number(obj.statusCode);
		} else {
			return 500;
		}
	};

	//------------------------------------------------------------
	// return true if the code is an error http status code
	//------------------------------------------------------------
	exports.is_error_code = (code) => {
		code = Number(code);
		if (!isNaN(code)) {
			if (code >= 400) {
				return true;
			}
		}
		return false;
	};

	//------------------------------------------------------------
	// format timestamp in ms to x.x FRIENDLY_UNITS. ex: 6.4 mins, or 2.0 secs (negative values become 0)
	//------------------------------------------------------------
	exports.friendly_ms = (ms) => {
		let ret = '';
		ms = Number(ms);
		if (isNaN(ms)) { ret = '? sec'; }
		else if (ms <= 0) { ret = '0 secs'; }
		else if (ms > 24 * 60 * 60 * 1000) { ret = (ms / 1000 / 60 / 60 / 24).toFixed(1) + ' days'; }//format for days
		else if (ms > 60 * 60 * 1000) { ret = (ms / 1000 / 60 / 60).toFixed(1) + ' hrs'; }	//format for hours
		else if (ms > 60 * 1000) { ret = (ms / 1000 / 60).toFixed(1) + ' mins'; }			//format for mins
		else if (ms > 1000) { ret = (ms / 1000).toFixed(1) + ' secs'; }						//format for secs
		else { ret = ms.toFixed(1) + ' ms'; }												//format to ms
		return ret;
	};

	//------------------------------------------------------------
	// format a large number to x.xx FRIENDLY_UNITS. ex: 1234567 -> '1.23m' (negative values become 0)
	//------------------------------------------------------------
	exports.friendly_number = function (num, dec) {
		let ret = '';
		dec = !isNaN(dec) ? dec : 2;
		num = Number(num);
		if (isNaN(num)) { ret = '?'; }
		else if (num <= 0) { ret = '0'; }
		else if (num > 1000 * 1000 * 1000 * 1000) { ret = (num / 1000 / 1000 / 1000 / 1000).toFixed(dec) + 'T'; }	// format for trillions
		else if (num > 1000 * 1000 * 1000) { ret = (num / 1000 / 1000 / 1000).toFixed(dec) + 'B'; }					// format for billions
		else if (num > 1000 * 1000) { ret = (num / 1000 / 1000).toFixed(dec) + 'M'; }								// format for millions
		else if (num > 1000) { ret = (num / 1000).toFixed(dec) + 'K'; }												// format for thousands
		else { ret = num.toFixed(dec); }																			// format to base
		return ret;
	};

	//------------------------------------------------------------
	// format bytes to x.x FRIENDLY_UNITS. ex: 6.4 GB, or 2.0 MB (negative values become 0)
	//------------------------------------------------------------
	exports.friendly_bytes = function (bytes, digits) {
		let ret = '';
		if (digits === undefined) {
			digits = 2;
		}
		bytes = Number(bytes);
		if (isNaN(bytes)) { ret = '? Bytes'; }
		else if (bytes <= 0) { ret = '0 Bytes'; }
		else if (bytes >= 1024 * 1024 * 1024 * 1024) { ret = (bytes / 1024 / 1024 / 1024 / 1024).toFixed(digits) + ' TiB'; }
		else if (bytes >= 1024 * 1024 * 1024) { ret = (bytes / 1024 / 1024 / 1024).toFixed(digits) + ' GiB'; }
		else if (bytes >= 1024 * 1024) { ret = (bytes / 1024 / 1024).toFixed(digits) + ' MiB'; }
		else if (bytes >= 1024) { ret = (bytes / 1024).toFixed(digits) + ' KiB'; }
		else { ret = bytes.toFixed(digits) + ' Bytes'; }
		return ret;
	};

	// ------------------------------------------------------
	// Pull each doc field out of the response
	// ------------------------------------------------------
	exports.parse_for_docs = (body) => {
		let ret = [];
		if (body && body.results) {
			for (let i in body.results) {
				if (body.results[i].docs && body.results[i].docs[0]) {
					ret.push(body.results[i].docs[0].ok);
				}
			}
		}
		return ret;
	};

	// ------------------------------------------------------
	// Pull each doc id out of the response
	// ------------------------------------------------------
	exports.parse_for_ids = (body) => {
		let ret = [];
		if (body && body.rows) {
			for (let i in body.rows) {
				if (body.rows[i].id) {
					ret.push({ id: body.rows[i].id, rev: body.rows[i].rev });
				}
			}
		}
		return ret;
	};

	// --------------------------------------------
	// check the input options
	// --------------------------------------------
	exports.check_inputs = (opts) => {
		const errors = [];
		if (isNaN(opts.max_rate_per_sec)) {
			errors.push('"max_rate_per_sec" must be a number');
		}
		if (isNaN(opts.max_parallel)) {
			errors.push('"max_parallel" must be a number');
		}
		if (isNaN(opts.head_room_percent)) {
			errors.push('"head_room_percent" must be a number');
		}
		if (isNaN(opts.min_rate_per_sec)) {
			errors.push('"min_rate_per_sec" must be a number');
		}
		if (isNaN(opts.batch_get_bytes_goal)) {
			errors.push('"batch_get_bytes_goal" must be a number');
		}

		if (!opts.db_connection || typeof opts.db_connection !== 'string') {
			errors.push('"db_connection" must be a string');
		}
		if (!opts.db_name || typeof opts.db_name !== 'string') {
			errors.push('"db_name" must be a string');
		}

		if (!opts.write_stream) {
			errors.push('"write_stream" must be a stream');
		}

		if (opts.head_room_percent < 0 || opts.head_room_percent >= 100) {
			errors.push('"head_room_percent" must be >= 0 and < 100');
		}

		return errors;
	};

	return exports;
};
