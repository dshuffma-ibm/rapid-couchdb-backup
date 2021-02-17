// break up stream on each newline character (encoded new lines are skipped over)
//
// source is orig from http://strongloop.com/strongblog/practical-examples-of-the-new-node-js-streams-api/
// source is from https://github.com/cloudant/couchbackup/blob/master/includes/liner.js
const stream = require('stream');

module.exports = function () {
	const liner = new stream.Transform({ objectMode: true });

	liner._transform = function (chunk, encoding, done) {
		let data = chunk.toString();
		if (this._lastLineData) {
			data = this._lastLineData + data;
		}

		const lines = data.split('\n');
		this._lastLineData = lines.splice(lines.length - 1, 1)[0];

		for (let i in lines) {
			this.push(lines[i]);
		}
		done();
	};

	liner._flush = function (done) {
		if (this._lastLineData) {
			this.push(this._lastLineData);
		}
		this._lastLineData = null;
		done();
	};

	return liner;
};
