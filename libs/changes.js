// parse each change entry to an object
//
// source is orig from http://strongloop.com/strongblog/practical-examples-of-the-new-node-js-streams-api/
// source is from https://github.com/cloudant/couchbackup/blob/master/includes/change.js
const stream = require('stream');

module.exports = function (onChange) {
	const change = new stream.Transform({ objectMode: true });

	change._transform = function (line, encoding, done) {
		let obj = null;

		// one change per line - remove the trailing comma
		line = line.trim().replace(/,$/, '');

		// extract the last_seq at the end of the changes feed
		if (line.match(/^"last_seq":/)) {
			line = '{' + line;
		}

		// parse to an object
		try {
			obj = JSON.parse(line);
		} catch (e) {}

		// pass object to handler function
		onChange(obj);

		// end
		done();
	};

	return change;
};
