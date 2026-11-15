---
outline: false
---

<script setup>
import { data as versions } from '../guide/versions.data.js';
</script>

# Versions

Each version has its Docker image (`ghcr.io/luquypest/bot-ticketting:<version>`) and its [release](https://github.com/LuquyPest/Bot-ticketting/releases) page. To update: [Updates](./updates). Notes are in English from v3.0 on; older versions stay in French.

<div v-for="v in versions.map(x => x.en)" :key="v.version" class="tb-version">
  <h2 :id="v.version">{{ v.version }} <small>{{ v.date }}</small></h2>
  <p class="tb-version-title">{{ v.title }}</p>
  <ul>
    <li v-for="(c, i) in v.changes" :key="i"><span :class="['tb-tag', c.type]">{{ c.label }}</span> {{ c.text }}</li>
  </ul>
</div>

<style>
.tb-version h2 { display: flex; align-items: baseline; gap: 12px; }
.tb-version h2 small { font-size: 14px; font-weight: 500; color: var(--vp-c-text-3); }
.tb-version-title { margin-top: -8px; font-weight: 600; color: var(--vp-c-text-2); }
.tb-version ul { padding-left: 0; }
.tb-version li { list-style: none; display: grid; grid-template-columns: 104px 1fr; align-items: start; gap: 4px; }
.tb-version li .tb-tag { margin-top: 3px; }
.tb-tag { display: inline-block; width: 92px; text-align: center; font-size: 11px; font-weight: 600; padding: 1px 6px; margin-right: 8px; border-radius: 3px; border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-2); }
.tb-tag.new { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-2); }
.tb-tag.fix { color: var(--vp-c-danger-1); border-color: var(--vp-c-danger-2); }
.tb-tag.impr { color: var(--vp-c-success-1); border-color: var(--vp-c-success-2); }
</style>
