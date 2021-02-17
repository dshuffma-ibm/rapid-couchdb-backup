//------------------------------------------------------------
// clean_old.js - run the old backup lib and clean its output to match the new format
//------------------------------------------------------------
const fs = require('fs');
const backup = fs.readFileSync('./_old_backup.json').toString();
const misc = require('../libs/misc.js')();
const active_docs = misc._clean_backup_data(backup);

// write output
fs.writeFileSync('./_old_backup_cleaned.json', JSON.stringify(active_docs));
