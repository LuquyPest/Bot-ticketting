import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useInstanceInfo } from '../hooks/useInstanceInfo';

// Link to the privacy policy: the page set by the owner (PRIVACY_URL), otherwise this one
export const privacyHref = info => info?.privacyUrl || '/confidentialite';

const H = ({ children }) => <h2 className="text-base font-semibold text-ink-1 mt-8 mb-2">{children}</h2>;

// Built-in privacy notice, valid for any instance: what the bot stores, why, for how long, and
// whom to contact. The owner can replace it with their own page (PRIVACY_URL).
export default function Privacy() {
  const info = useInstanceInfo();
  const name = info?.name || 'Ce bot';
  useEffect(() => {
    if (info?.privacyUrl) window.location.replace(info.privacyUrl);
    document.title = 'Confidentialité';
  }, [info]);

  return (
    <div className="min-h-screen bg-base text-ink-2">
      <main className="max-w-2xl mx-auto px-4 py-10 text-sm leading-relaxed">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1"><ArrowLeft size={13} /> Retour</Link>
        <h1 className="text-2xl font-bold text-ink-1 mt-6">Confidentialité</h1>
        <p className="mt-2 text-ink-3"><span translate="no">{name}</span> est un bot de support Discord installé et administré par son propriétaire. Cette page décrit les données qu'il traite.</p>

        <H>Données enregistrées</H>
        <ul className="list-disc pl-5 space-y-1">
          <li>Ton identifiant, ton nom et ton avatar Discord, quand tu écris au bot ou te connectes à un de ses espaces web.</li>
          <li>Le contenu de tes tickets : messages, pièces jointes, sujet, réponses à un formulaire et note donnée en fin de ticket.</li>
          <li>Pour le staff : les connexions au dashboard (date, adresse IP, navigateur) et les actions effectuées, pour la sécurité et le suivi.</li>
        </ul>

        <H>Pourquoi</H>
        <p>Uniquement pour traiter les demandes de support du serveur Discord concerné : les transmettre à son équipe, garder l'historique de l'échange et mesurer la qualité du support. Rien n'est vendu, ni utilisé à des fins publicitaires.</p>

        <H>Qui y a accès</H>
        <p>Le staff du serveur Discord où le ticket a été ouvert, selon ses droits, et le propriétaire du bot. Les données sont hébergées sur le serveur choisi par ce propriétaire ; elles ne sont pas transmises à des tiers, hormis Discord lui-même pour l'acheminement des messages.</p>

        <H>Durée de conservation</H>
        <p>Les tickets et leurs transcripts sont conservés tant que le serveur Discord utilise le bot, sauf durée plus courte fixée par le propriétaire. Les journaux de connexion sont effacés après 90 jours.</p>

        <H>Tes droits</H>
        <p>Tu peux demander à consulter ou à supprimer tes données. Le staff du serveur dispose d'un outil de suppression complète (tickets, messages, historique).
          {info?.contactEmail ? <> Contact : <a className="text-primary-light underline" href={`mailto:${info.contactEmail.replace(/^mailto:/, '')}`}>{info.contactEmail.replace(/^mailto:/, '')}</a>.</> : ' Adresse-toi au staff du serveur Discord.'}
        </p>
      </main>
    </div>
  );
}
