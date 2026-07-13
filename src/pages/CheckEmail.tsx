import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { MailCheck, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import bidboxLogo from "@/assets/bidbox-logo-auth.png";

const COOLDOWN_SECONDS = 60;

export default function CheckEmail() {
  const location = useLocation();
  const [params] = useSearchParams();
  const email = (location.state as { email?: string } | null)?.email ?? params.get("email") ?? "";
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const resend = async () => {
    if (!email || sending || cooldown) return;
    setSending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/calendar` },
    });
    setSending(false);
    if (error) {
      toast({ title: "Unable to resend", description: /rate/i.test(error.message) ? "Please wait before requesting another email." : "Please try again shortly.", variant: "destructive" });
      return;
    }
    setCooldown(COOLDOWN_SECONDS);
    toast({ title: "Verification email sent", description: "Check your inbox and Spam or Junk folder." });
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <section className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
        <Link to="/"><img src={bidboxLogo} alt="BidBox" className="mx-auto h-28 w-auto" /></Link>
        <MailCheck className="mx-auto mt-4 h-12 w-12 text-bidbox-blue" />
        <h1 className="mt-4 text-2xl font-bold">Check your email</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your account has been created. Check your inbox for the BidBox verification email{email ? <> sent to <strong className="text-foreground">{email}</strong></> : null} and click the verification link before signing in.
        </p>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-950">
          If it is not in your inbox, check Spam or Junk and mark the message as not spam.
        </div>
        <div className="mt-6 space-y-3">
          {email && (
            <Button variant="outline" className="w-full" onClick={resend} disabled={sending || cooldown > 0}>
              <RefreshCw className={`mr-2 h-4 w-4 ${sending ? "animate-spin" : ""}`} />
              {sending ? "Sending…" : cooldown ? `Resend available in ${cooldown}s` : "Resend verification email"}
            </Button>
          )}
          <Button asChild className="w-full"><Link to={`/auth?mode=login${email ? `&email=${encodeURIComponent(email)}` : ""}`}>Return to sign in</Link></Button>
        </div>
      </section>
    </main>
  );
}
