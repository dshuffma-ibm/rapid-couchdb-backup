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
		else { ret = ms.toFixed(0) + ' ms'; }												//format to ms
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
		else { ret = num.toFixed(0); }																				// format to base
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
	// Pull each doc field out of the changes response
	// ------------------------------------------------------
	exports.parse_for_docs_changes = (body) => {
		let ret = [];
		if (body && body.results) {
			for (let i in body.results) {
				if (body.results[i].doc) {
					ret.push(body.results[i].doc);
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
		if (isNaN(opts.max_parallel_reads)) {
			errors.push('"max_parallel_reads" must be a number');
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
		if (isNaN(opts.read_timeout_ms)) {
			errors.push('"read_timeout_ms" must be a number');
		}

		if (!opts.couchdb_url || typeof opts.couchdb_url !== 'string') {
			errors.push('"couchdb_url" must be a string');
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

	// --------------------------------------------
	// take the old backup lib format and clean its output to match the new format - used for testing only
	// --------------------------------------------
	exports._clean_backup_data = (backup) => {
		const parts = backup.split('\n');

		// breakup report by newlines and parse each section
		let docs = [];
		for (let i in parts) {										// skip the blank lines
			if (parts[i]) {
				try {
					const temp = JSON.parse(parts[i]);
					docs = docs.concat(temp);
					console.log('[clean] found section:', i, 'len:', temp.length);
				} catch (e) {
					console.error(e);
				}
			}
		}
		console.log('[clean] found docs:', docs.length);

		// remove docs that are deleted
		let active_docs = [];
		for (let i in docs) {
			if (!docs[i]._deleted) {
				delete docs[i]._revisions;
				active_docs.push(docs[i]);
			}
		}

		// sort the docs
		console.log('[clean] found active docs:', active_docs.length);
		active_docs.sort(function (a, b) {
			return (a._id > b._id) ? 1 : -1;
		});
		return active_docs;
	};

	// --------------------------------------------
	// take an iam access token and build an auth header
	// --------------------------------------------
	exports.build_headers = () => {
		const headers = {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		};
		if (process.env.IAM_ACCESS_TOKEN) {			// add the latest access token if we have one
			headers['Authorization'] = 'Bearer ' + process.env.IAM_ACCESS_TOKEN;
		}
		return headers;
	};

	// --------------------------------------------
	// see if we hit a database does not-exist error, if so put it first, makes it easier to parse for it
	// --------------------------------------------
	exports.order_errors = (errors) => {
		if (Array.isArray(errors)) {
			const ordered_errs = [];
			for (let i in errors) {
				if (exports.look_for_db_dne_err(errors[i])) {
					ordered_errs.push(errors[i]);		// put this error first, always
					errors.splice(i, 1);
					break;
				}
			}

			if (ordered_errs.length > 0) {
				return ordered_errs.concat(errors);
			}
		}

		return errors;
	};

	// --------------------------------------------
	// see if we hit a database does not-exist error, if so put it first, makes it easier to parse for it
	// --------------------------------------------
	exports.look_for_db_dne_err = (error) => {
		if (error && error.reason === 'Database does not exist.') {
			return true;
		} else {
			return false;
		}
	};

	// ------------------------------------------
	// return the url with auth if applicable but no path
	// ------------------------------------------
	exports.get_base_url = function (url_str, hide_auth) {
		const parts = exports.break_up_url(url_str);
		if (!parts) {
			return null;
		} else {
			let port = parts.port ? (':' + parts.port) : '';
			if (hide_auth === true) {
				return parts.protocol + '//' + parts.hostname + port;
			} else {
				return parts.protocol + '//' + parts.auth_str + parts.hostname + port;
			}
		}
	};

	// ------------------------------------------
	// break up url in proto, basic auth, hostname, port, etc
	// ------------------------------------------
	exports.break_up_url = function (url_str) {
		if (url_str && typeof url_str === 'string' && !url_str.includes('://')) {	// if no protocol, assume https
			url_str = 'https://' + url_str;											// append https so we can parse it
		}

		const parts = new URL(url_str);
		if (!parts || !parts.hostname) {
			return null;
		} else {
			const protocol = parts.protocol ? parts.protocol : 'https:';			// default protocol is https
			if (!parts.port) {
				parts.port = (protocol === 'https:') ? '443' : '80';				// match default ports to protocol
			}
			parts.auth_str = parts.username ? parts.username + ':' + parts.password + '@' : '';	// defaults to no auth

			return parts;
		}
	};

	return exports;
};
