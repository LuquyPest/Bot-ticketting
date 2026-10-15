// RFC 4180 cell + neutralises spreadsheet formulas (=, +, -, @, tab, CR) coming from user input.
function csvCell(val) {
  if (val == null) return '';
  let str = val instanceof Date ? val.toISOString() : String(val);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

module.exports = { csvCell };
