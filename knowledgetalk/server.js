// Vite dev 실행 방식이 아닌 WebRTC + HTTPS 강제 로컬 테스트 필요시 사용

import express from "express";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5174;

const keyPath = path.join(__dirname, "cert/localhost-key.pem");
const certPath = path.join(__dirname, "cert/localhost.pem");

const httpsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist/index.html"));
});

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`HTTPS server listening on https://localhost:${PORT}`);
});
