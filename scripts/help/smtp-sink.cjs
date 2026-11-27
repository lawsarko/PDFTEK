// A tiny SMTP server that accepts every email and saves it to a folder (for screenshots and tests).
// Usage: node scripts/help/smtp-sink.cjs <port> <dir>   then SMTP_URL=smtp://localhost:<port>
const net = require("net");
const fs = require("fs");
const path = require("path");
const [port = "2525", dir = "./mail"] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
let n = 0;
net
  .createServer((s) => {
    let data = false;
    let buf = "";
    let mail = "";
    s.write("220 sink ready\r\n");
    s.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (data) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) return;
        mail += buf.slice(0, end);
        buf = buf.slice(end + 5);
        fs.writeFileSync(path.join(dir, `${Date.now()}-${n++}.eml`), mail);
        mail = "";
        data = false;
        s.write("250 queued\r\n");
      }
      let i;
      while (!data && (i = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") s.write("250-sink\r\n250 OK\r\n");
        else if (cmd === "DATA") {
          data = true;
          s.write("354 go ahead\r\n");
          if (buf.includes("\r\n.\r\n")) s.emit("data", Buffer.alloc(0));
        } else if (cmd === "QUIT") {
          s.write("221 bye\r\n");
          s.end();
        } else s.write("250 OK\r\n");
      }
    });
    s.on("error", () => {});
  })
  .listen(Number(port), () => console.log(`smtp sink on ${port} -> ${dir}`));
