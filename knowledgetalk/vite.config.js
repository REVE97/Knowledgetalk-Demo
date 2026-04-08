import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "node:fs";

export default defineConfig({
  plugins: [vue()],
  server: {
    https: fs.existsSync("cert/localhost.pem") && fs.existsSync("cert/localhost-key.pem")
      ? {
          cert: fs.readFileSync("cert/localhost.pem"),
          key: fs.readFileSync("cert/localhost-key.pem")
        }
      : undefined
  }
});
