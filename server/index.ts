import 'dotenv/config';
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { registerRoutes } from "./routes";
import { initializeRelayServer } from "./relay-server";
import * as fs from "fs";
import * as path from "path";

const app = express();
const log = console.log;

// Global Roon control instance (to avoid issues with dynamic imports)
let globalRoonControl: any = null;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    // Allow localhost for local development
    origins.add("http://localhost:8081");
    origins.add("http://localhost:8082");
    origins.add("http://localhost:19006");
    origins.add("http://127.0.0.1:8081");
    origins.add("http://127.0.0.1:8082");
    origins.add("http://127.0.0.1:19006");

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    // Allow any origin from private IP ranges or localhost for local development
    const isAllowedOrigin = origin && (
      origins.has(origin) ||
      origin.startsWith("http://192.168.") ||
      origin.startsWith("http://10.") ||
      (origin.startsWith("http://172.") && (() => {
        const parts = origin.split(".");
        if (parts.length >= 2) {
          const secondOctet = parseInt(parts[1]);
          return secondOctet >= 16 && secondOctet <= 31;
        }
        return false;
      })())
    );

    if (isAllowedOrigin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  // Serve Now Playing display page
  const nowPlayingPath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "now-playing-lms.html",
  );
  
  app.get("/now-playing", (req: Request, res: Response) => {
    // Read fresh from disk every time (no caching)
    const nowPlayingTemplate = fs.readFileSync(nowPlayingPath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(nowPlayingTemplate);
  });
  
  // Cast receiver endpoint (serves Cast receiver HTML)
  app.get("/cast-receiver", (req: Request, res: Response) => {
    const castReceiverPath = path.resolve(process.cwd(), "server", "templates", "now-playing.html");
    const receiverTemplate = fs.readFileSync(castReceiverPath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.status(200).send(receiverTemplate);
  });

  // Helper function to generate Metro error page HTML
  const getMetroErrorPage = () => `<!DOCTYPE html>
<html>
<head>
  <title>Metro Bundler Not Running</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 600px;
      margin: 100px auto;
      padding: 20px;
      text-align: center;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 20px;
    }
    p {
      color: #666;
      line-height: 1.6;
      margin-bottom: 30px;
    }
    .code {
      background: #f0f0f0;
      padding: 15px;
      border-radius: 6px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 14px;
      margin: 20px 0;
      text-align: left;
      overflow-x: auto;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #007AFF;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      margin-top: 20px;
    }
    .button:hover {
      background: #0051D5;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Metro Bundler Not Running</h1>
    <p>The Expo Metro bundler is required to run the web version of the app.</p>
    <p>To start the development server, run:</p>
    <div class="code">npm run all:dev:local</div>
    <p>Or start them separately:</p>
    <div class="code">
npm run server:dev<br>
npm run expo:dev:local
    </div>
    <a href="/" class="button">← Back to Home</a>
  </div>
</body>
</html>`;

  // Serve landing page at root - web app is accessed directly at localhost:8081
  // No need to proxy root to Metro since Metro serves the web app directly
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  log("Serving static Expo files with dynamic manifest routing");

  // Handle manifest requests for mobile platforms
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/manifest") {
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
    }
    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  // Exclude /client from static file serving - it's handled by Metro proxy
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/client")) {
      return next(); // Skip static serving for /client paths
    }
    express.static(path.resolve(process.cwd(), "static-build"))(req, res, next);
  });

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
      stack?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    // Log the error for debugging
    console.error("[Server] Error handler caught:", message);
    if (error.stack) {
      console.error("[Server] Stack trace:", error.stack);
    }

    // Don't throw - just send error response and log
    // Throwing here causes the server to crash and restart
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });
}

// Handle uncaught exceptions and unhandled rejections to prevent server crashes
process.on("uncaughtException", (error: Error) => {
  console.error("[Server] Uncaught exception:", error.message);
  console.error("[Server] Stack:", error.stack);
  // Don't exit - log and continue
});

process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("[Server] Unhandled rejection at:", promise);
  console.error("[Server] Reason:", reason);
  // Don't exit - log and continue
});

(async () => {
  try {
    setupCors(app);
    setupBodyParsing(app);
    setupRequestLogging(app);

    // Register /client proxy FIRST - before any other routes
    // This must be at the top level to ensure it matches before static file middleware
    app.use("/client", createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true, // Change origin to match Metro's expected host
      ws: true,
      secure: false,
    }));

    configureExpoAndLanding(app);

    // Initialize the relay server (Chromecast casting logic)
    initializeRelayServer(app);

    const server = await registerRoutes(app);
// const server = createServer(app);

    setupErrorHandler(app);

    const port = parseInt(process.env.PORT || "3000", 10);
    server.listen(port, "0.0.0.0", () => {
      log(`express server serving on port ${port}`);
    }).on("error", (err: unknown) => {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "EADDRINUSE") {
        log(
          `[Server] Port ${port} is already in use. Another instance of the proxy is probably running. ` +
          `If you want to restart it, kill the existing process on port ${port} first.`
        );
        process.exit(1); // Exit on port conflict
      } else {
        log("[Server] Unhandled listen error:", error);
        process.exit(1); // Exit on other listen errors
      }
    });
  } catch (error) {
    console.error("[Server] Failed to start:", error);
    process.exit(1);
  }
})();
