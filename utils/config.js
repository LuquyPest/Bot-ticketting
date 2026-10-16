// Single place that loads config.json. TICKETBOT_CONFIG overrides the path (test suite / CI),
// so tests never read the production file.
const path = require('path');

const CONFIG_PATH = process.env.TICKETBOT_CONFIG
  ? path.resolve(process.env.TICKETBOT_CONFIG)
  : path.join(__dirname, '..', 'config.json');

module.exports = { config: require(CONFIG_PATH), CONFIG_PATH };
