import { createRouter, createWebHistory } from "vue-router";
import P2PView from "../views/P2PView.vue";
import GroupView from "../views/GroupView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/p2p" },
    { path: "/p2p", component: P2PView },
    { path: "/group", component: GroupView }
  ]
});
