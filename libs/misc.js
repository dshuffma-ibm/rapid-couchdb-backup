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

	return exports;
};
