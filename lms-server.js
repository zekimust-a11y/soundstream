const http = require("http");
const { spawn } = require("child_process");

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/lms/proxy") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      const { command, playerId } = JSON.parse(body);
      const jsonRpc = { id: 1, method: "slim.request", params: [playerId || "", command] };
      const data = JSON.stringify(jsonRpc);
      
      const curl = spawn("curl", [
        "-s", "-X", "POST", 
        "-H", "Content-Type: application/json",
        "-H", "Connection: close",
        "--data-binary", data,
        "http://192.168.0.19:9000/jsonrpc.js"
      ]);
      
      let stdout = "";
      curl.stdout.on("data", d => stdout += d);
      curl.on("close", code => {
        res.setHeader("Content-Type", "application/json");
        if (code === 0 && stdout.trim()) {
          res.end(stdout.trim());
        } else {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "LMS failed" }));
        }
      });
    });
  } else {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.listen(3001, "127.0.0.1", () => console.log("LMS server on 3001"));
