// E-mails sent by the instance itself (not by a support mailbox): invitations, sign-in links,
// password resets, test. French and English; {variables} as in the other dictionaries.
// Each one: subject, then the text (the HTML version is built from it).
module.exports = {
  fr: {
    test: { subject: 'Test de l\'e-mail de {app}', text: 'Bonjour,\n\nCet e-mail confirme que {app} peut envoyer des e-mails depuis {url}.\n\nRien d\'autre à faire.' },
    invitation: { subject: 'Invitation à rejoindre {space} sur {app}', text: 'Bonjour,\n\n{by} t\'invite à rejoindre l\'équipe de {space} sur {app}.\n\nAccepter l\'invitation : {link}\n\nCe lien est valable {days} jours et ne sert qu\'une fois. Si tu ne t\'attendais pas à cette invitation, ignore cet e-mail.' },
    loginLink: { subject: 'Ton lien de connexion à {app}', text: 'Bonjour,\n\nPour te connecter à {app}, ouvre ce lien :\n\n{link}\n\nIl est valable {minutes} minutes et ne sert qu\'une fois. Si tu n\'as rien demandé, ignore cet e-mail : personne ne peut se connecter sans ce lien.' },
    passwordReset: { subject: 'Réinitialiser ton mot de passe {app}', text: 'Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien :\n\n{link}\n\nIl est valable {minutes} minutes et ne sert qu\'une fois. Si tu n\'as rien demandé, ignore cet e-mail : ton mot de passe reste le même.' },
    verifyEmail: { subject: 'Confirme ton adresse e-mail sur {app}', text: 'Bonjour,\n\nPour relier cette adresse à ton compte {app}, ouvre ce lien :\n\n{link}\n\nIl est valable {hours} heures et ne sert qu\'une fois. Si tu n\'as rien demandé, ignore cet e-mail.' },
    portalMessage: { subject: '{space} — ticket #{id} : nouveau message', text: 'Bonjour,\n\n{body}\n\nRépondre ou suivre ta demande : {link}\n\nPour répondre, utilise ce lien : les réponses à cet e-mail ne sont pas lues.' },
    footer: 'E-mail envoyé automatiquement par {app} ({url}).',
  },
  en: {
    test: { subject: '{app} e-mail test', text: 'Hello,\n\nThis e-mail confirms that {app} can send e-mails from {url}.\n\nNothing else to do.' },
    invitation: { subject: 'Invitation to join {space} on {app}', text: 'Hello,\n\n{by} invites you to join the team of {space} on {app}.\n\nAccept the invitation: {link}\n\nThis link is valid for {days} days and works only once. If you did not expect this invitation, ignore this e-mail.' },
    loginLink: { subject: 'Your sign-in link to {app}', text: 'Hello,\n\nTo sign in to {app}, open this link:\n\n{link}\n\nIt is valid for {minutes} minutes and works only once. If you did not ask for it, ignore this e-mail: nobody can sign in without this link.' },
    passwordReset: { subject: 'Reset your {app} password', text: 'Hello,\n\nTo choose a new password, open this link:\n\n{link}\n\nIt is valid for {minutes} minutes and works only once. If you did not ask for it, ignore this e-mail: your password stays the same.' },
    verifyEmail: { subject: 'Confirm your e-mail address on {app}', text: 'Hello,\n\nTo link this address to your {app} account, open this link:\n\n{link}\n\nIt is valid for {hours} hours and works only once. If you did not ask for it, ignore this e-mail.' },
    portalMessage: { subject: '{space} — ticket #{id}: new message', text: 'Hello,\n\n{body}\n\nAnswer or follow your request: {link}\n\nTo answer, use this link: replies to this e-mail are not read.' },
    footer: 'E-mail sent automatically by {app} ({url}).',
  },
};
