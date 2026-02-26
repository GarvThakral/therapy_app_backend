import "dotenv/config";

import cors from "cors";
import express from "express";

import healthHandler from "./api/health";
import loginHandler from "./api/auth/login";
import meHandler from "./api/auth/me";
import signupHandler from "./api/auth/signup";
import fakePaymentHandler from "./api/billing/fake-payment";
import accountHandler from "./api/account/index";
import profileHandler from "./api/profile/index";
import logHandler from "./api/logs/index";
import logItemHandler from "./api/logs/[id]";
import sessionsHandler from "./api/sessions/index";
import sessionItemHandler from "./api/sessions/[id]";
import homeworkHandler from "./api/homework/index";
import homeworkItemHandler from "./api/homework/[id]";
import usersCountHandler from "./api/users/count";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  }),
);
app.use(express.json());

function wrap(handler: (req: any, res: any) => Promise<any> | any) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await handler(req as any, res as any);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal Server Error",
      });
    }
  };
}

app.get("/api/health", wrap(healthHandler));
app.get("/api/users/count", wrap(usersCountHandler));

app.options("/api/auth/signup", wrap(signupHandler));
app.post("/api/auth/signup", wrap(signupHandler));

app.options("/api/auth/login", wrap(loginHandler));
app.post("/api/auth/login", wrap(loginHandler));

app.options("/api/auth/me", wrap(meHandler));
app.get("/api/auth/me", wrap(meHandler));

app.options("/api/billing/fake-payment", wrap(fakePaymentHandler));
app.post("/api/billing/fake-payment", wrap(fakePaymentHandler));

app.options("/api/account", wrap(accountHandler));
app.delete("/api/account", wrap(accountHandler));

app.options("/api/profile", wrap(profileHandler));
app.get("/api/profile", wrap(profileHandler));
app.put("/api/profile", wrap(profileHandler));

app.options("/api/logs", wrap(logHandler));
app.get("/api/logs", wrap(logHandler));
app.post("/api/logs", wrap(logHandler));

app.options("/api/logs/:id", wrap(logItemHandler));
app.patch("/api/logs/:id", wrap((req, res) => {
  (req as any).query = { ...req.query, id: req.params.id };
  return logItemHandler(req as any, res as any);
}));

app.options("/api/sessions", wrap(sessionsHandler));
app.get("/api/sessions", wrap(sessionsHandler));
app.post("/api/sessions", wrap(sessionsHandler));

app.options("/api/sessions/:id", wrap(sessionItemHandler));
app.patch("/api/sessions/:id", wrap((req, res) => {
  (req as any).query = { ...req.query, id: req.params.id };
  return sessionItemHandler(req as any, res as any);
}));
app.delete("/api/sessions/:id", wrap((req, res) => {
  (req as any).query = { ...req.query, id: req.params.id };
  return sessionItemHandler(req as any, res as any);
}));

app.options("/api/homework", wrap(homeworkHandler));
app.get("/api/homework", wrap(homeworkHandler));
app.post("/api/homework", wrap(homeworkHandler));

app.options("/api/homework/:id", wrap(homeworkItemHandler));
app.patch("/api/homework/:id", wrap((req, res) => {
  (req as any).query = { ...req.query, id: req.params.id };
  return homeworkItemHandler(req as any, res as any);
}));
app.delete("/api/homework/:id", wrap((req, res) => {
  (req as any).query = { ...req.query, id: req.params.id };
  return homeworkItemHandler(req as any, res as any);
}));
app.delete("/api/logs/:id", wrap((req, res) => {
  (req as any).query = { ...req.query, id: req.params.id };
  return logItemHandler(req as any, res as any);
}));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend running on http://localhost:${port}`);
});
