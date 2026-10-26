"use client";
import { useEffect } from "react";

/**
 * Supabase email links (password reset, confirm email, sign-in link) carry the session in the URL
 * fragment. If the redirect address isn't on Supabase's allow-list, Supabase sends people to the
 * Site URL (usually the home page) instead of /auth/confirm, and the link seems to do nothing.
 * Wherever such a fragment lands, hand it to /auth/confirm, which finishes the job.
 */
export function AuthLinkCatcher() {
  useEffect(() => {
    if (window.location.pathname === "/auth/confirm") return;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("access_token") || hash.get("error_code") || (hash.get("error") && hash.get("error_description"))) {
      window.location.replace(`/auth/confirm${window.location.hash}`);
    }
  }, []);
  return null;
}
