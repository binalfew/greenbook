import { createCookieSessionStorage } from "react-router";

export const authSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "authSession",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secrets: process.env.SESSION_SECRET.split(","),
    secure: process.env.NODE_ENV === "production",
  },
});
