//=======================================================================================================
// Basic couchdb operations
//=======================================================================================================
module.exports = (DB_CONNECTION_STRING) => {
	const couch = {};
	const url = require('url');
	const request = require('request');
	const couch_url = build_couch_base_url(DB_CONNECTION_STRING);
	const misc = require('./misc.js')();

	// format our response from request module's response
	function formatResponse(resp) {
		let ret = { error: 'resp is null' };			// default

		if (resp && resp.body) {
			try {
				ret = JSON.parse(resp.body);
			} catch (e) {
				ret = resp.body;
			}
		}

		return ret;
	}

	// build the url to connect to couch
	function build_couch_base_url(dbConnectionString) {
		const parts = url.parse(dbConnectionString);
		if (!parts) {
			return null;
		} else {
			if (!parts.protocol) {
				parts.protocol = 'http:';				// no protocol, defaults to http
			}
			if (parts.protocol === 'https:') {
				if (!parts.port) {						// no port for https, defaults 443
					parts.port = 443;
				}
			} else {									// no port for http, defaults 80
				if (!parts.port) {
					parts.port = 80;
				}
			}
			const auth_str = (parts.auth) ? parts.auth + '@' : '';	// defaults to no auth

			return parts.protocol + '//' + auth_str + parts.hostname + ':' + parts.port;
		}
	}

	//-------------------------------------------------------------
	// Get Database Data
	//-------------------------------------------------------------
	/*
		opts: {
			db_name: "name of db"
		}
	*/
	couch.get_db_data = (opts, cb) => {
		const options = {
			method: 'GET',
			baseUrl: couch_url,
			url: '/' + opts.db_name + '?' + (opts.query ? opts.query : null),
			timeout: 30000,
			headers: {
				'Accept': 'application/json'
			}
		};
		request(options, (_, resp) => {
			if (misc.is_error_code(misc.get_code(resp))) {
				return cb(formatResponse(resp), null);
			}
			return cb(_, formatResponse(resp));
			/* example response
			{
				"update_seq": "71239--6DjNESINuQY-aDjJErJcEYkMSfIwJ4RmAQDt3bMB",
				"db_name": "something",
				"purge_seq": 0,
				"sizes": {
					"file": 2214578112,
					"external": 6697485413,
					"active": 2173544756
				},
				"props": {  },
				"doc_del_count": 195,
				"doc_count": 44804,
				"disk_format_version": 8,
				"compact_running": false,
				"cluster": {
					"q": 8,
					"n": 3,
					"w": 2,
					"r": 2
				},
				"instance_start_time": "0"
				}
			*/
		});
	};

	//-------------------------------------------------------------
	// Get all_docs
	//-------------------------------------------------------------
	/*
		opts: {
			db_name: "name of db",
			query: "limit=1000",
		}
	*/
	couch.getAllDocs = (opts, cb) => {
		const options = {
			method: 'GET',
			baseUrl: couch_url,
			url: '/' + opts.db_name + '/_all_docs?include_docs=true' + (opts.query ? opts.query : null),
			timeout: 30000,
			headers: {
				'Accept': 'application/json'
			}
		};
		request(options, (_, resp) => {
			if (misc.is_error_code(misc.get_code(resp))) {
				return cb(formatResponse(resp), null);
			}
			return cb(_, formatResponse(resp));
		});
	};

	//------------------------------------------------------------
	// Get _changes feed from db
	//------------------------------------------------------------
	couch.get_changes = (opts, cb) => {
		const options = {
			baseUrl: couch_url,
			url: '/' + opts.db_name + '/_changes?style=main_only' + (opts.since ? '&since=' + opts.since : ''),
			method: 'GET',
			timeout: 90000,
			headers: { 'Accept': 'application/json' }
		};

		// --------- Handle Data --------- //
		request(options, (error, resp) => {
			if (misc.is_error_code(misc.get_code(resp))) {
				return cb(formatResponse(resp), null);
			}
			return cb(error, formatResponse(resp));
		});
	};

	return couch;
};
