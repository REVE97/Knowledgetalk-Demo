<template>
  <main>
    <header style="display:flex; gap:10px; align-items:center;">
      <nav style="display:flex; gap:10px;">
        <RouterLink to="/p2p">P2P</RouterLink>
        <RouterLink to="/group">GROUP</RouterLink>
      </nav>
    </header>

    <RouterView />
  </main>
</template>

<script setup>
import { RouterLink, RouterView } from "vue-router";
</script>
