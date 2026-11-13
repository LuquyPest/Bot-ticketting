<script setup>
import { withBase } from 'vitepress';
// Screenshots of the dashboard (docs/public/images, made by dashboard/tests/readme-shots.mjs)
const shots = [
  { src: '/images/ticket.png', title: 'Fiche ticket', text: 'Conversation, notes internes, attribution, suivi, temps passé.' },
  { src: '/images/split-view.png', title: 'Vue fractionnée', text: 'La liste et le ticket côte à côte, sans changer de page.' },
  { src: '/images/instance.png', title: 'Section Instance', text: 'Tes serveurs, la santé du bot, les erreurs et le journal.' },
  { src: '/images/member-portal.png', title: 'Espace membre', text: 'Le membre suit ses tickets et répond depuis le web.' },
  { src: '/images/dashboard-light.png', title: 'Thème clair', text: 'Sombre ou clair, interface Pro ou Classique, FR ou EN.' },
  { src: '/images/ticket-mobile.png', title: 'Sur téléphone', text: 'Tout le dashboard, adapté aux petits écrans.', narrow: true },
];
</script>

<template>
  <section class="tb-gallery" aria-label="Captures d'écran">
    <figure v-for="s in shots" :key="s.src" :class="{ narrow: s.narrow }">
      <a :href="withBase(s.src)" target="_blank" rel="noopener"><img :src="withBase(s.src)" :alt="s.title" loading="lazy" /></a>
      <figcaption><strong>{{ s.title }}</strong> — {{ s.text }}</figcaption>
    </figure>
  </section>
</template>
