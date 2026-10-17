// Member DMs edited or deleted after being relayed to a ticket (see utils/dmEdits.js)
const { handleDmEdit, handleDmDelete } = require('../utils/dmEdits');

module.exports = {
  name: 'raw',
  async execute(client, packet) {
    try {
      if (packet.t === 'MESSAGE_UPDATE') await handleDmEdit(client, packet.d);
      else if (packet.t === 'MESSAGE_DELETE') await handleDmDelete(client, packet.d);
    } catch (err) {
      console.error('Erreur suivi des MP modifiés:', err.message);
    }
  },
};
