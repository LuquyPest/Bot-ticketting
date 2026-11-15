<script setup>
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';
// Screenshots of the dashboard (docs/public/images, made by dashboard/tests/readme-shots.mjs),
// captioned in the language of the page
const { lang } = useData();
const SHOTS = [
  { src: '/images/ticket.png', fr: ['Fiche ticket', 'Conversation, notes internes, attribution, suivi, temps passé.'], en: ['Ticket view', 'Conversation, internal notes, assignment, follow-up, time spent.'] },
  { src: '/images/split-view.png', fr: ['Vue fractionnée', 'La liste et le ticket côte à côte, sans changer de page.'], en: ['Split view', 'The list and the ticket side by side, without leaving the page.'] },
  { src: '/images/instance.png', fr: ['Section Instance', 'Tes serveurs, la santé du bot, les erreurs et le journal.'], en: ['Instance section', 'Your servers, the health of the bot, errors and the log.'] },
  { src: '/images/member-portal.png', fr: ['Espace membre', 'Le membre suit ses tickets et répond depuis le web.'], en: ['Member space', 'Members follow their tickets and reply from the web.'] },
  { src: '/images/dashboard-light.png', fr: ['Thème clair', 'Sombre ou clair, interface Pro ou Classique, FR ou EN.'], en: ['Light theme', 'Dark or light, Pro or Classic interface, English or French.'] },
  { src: '/images/ticket-mobile.png', fr: ['Sur téléphone', 'Tout le dashboard, adapté aux petits écrans.'], en: ['On a phone', 'The whole dashboard, fitted to small screens.'], narrow: true },
];
const en = computed(() => String(lang.value).startsWith('en'));
const shots = computed(() => SHOTS.map(s => { const [title, text] = en.value ? s.en : s.fr; return { src: s.src, title, text, narrow: s.narrow }; }));
</script>

<template>
  <section class="tb-gallery" :aria-label="en ? 'Screenshots' : 'Captures d\'écran'">
    <figure v-for="s in shots" :key="s.src" :class="{ narrow: s.narrow }">
      <a :href="withBase(s.src)" target="_blank" rel="noopener"><img :src="withBase(s.src)" :alt="s.title" loading="lazy" /></a>
      <figcaption><strong>{{ s.title }}</strong> — {{ s.text }}</figcaption>
    </figure>
  </section>
</template>
