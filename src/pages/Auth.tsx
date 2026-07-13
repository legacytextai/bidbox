import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { ArrowLeft, RefreshCw } from "lucide-react";
import bidboxLogo from "@/assets/bidbox-logo-auth.png";
import { authErrorMessage, isUnverifiedEmailError } from "@/lib/authMessages";

const authSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  company_name: z.string().optional(),
});

const safeNext = (raw: string | null): string => {
  if (!raw) return "/calendar";
  // Only allow same-origin relative paths.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/calendar";
  return raw;
};

const Auth = () => {
  const [searchParams] = useSearchParams();
  const emailFromUrl = searchParams.get("email") || "";
  const nextPath = safeNext(searchParams.get("next"));
  const [isLogin, setIsLogin] = useState(searchParams.get("mode") === "login" || !emailFromUrl);
  const [email, setEmail] = useState(emailFromUrl);
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        // If there's an error getting the session, clear stale data
        if (error) {
          console.error("Session error:", error);
          localStorage.removeItem("sb-ztuyjlyuzasbceepezua-auth-token");
          return;
        }
        
        // If we have a session, verify it's actually valid
        if (session) {
          // Try to get user data to verify session is not stale
          const { error: userError } = await supabase.auth.getUser();
          
          if (userError) {
            // Session is stale, clear it
            console.error("Stale session detected:", userError);
            localStorage.removeItem("sb-ztuyjlyuzasbceepezua-auth-token");
            await supabase.auth.signOut();
            return;
          }
          
          // Session is valid, redirect to projects
          navigate("/calendar");
        }
      } catch (err) {
        console.error("Auth check error:", err);
        localStorage.removeItem("sb-ztuyjlyuzasbceepezua-auth-token");
      }
    };
    checkUser();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthNotice(null);

    try {
      const validation = authSchema.parse({
        email,
        password,
        company_name: companyName,
      });

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email: validation.email,
          password: validation.password,
        });

        if (error) throw error;

        toast({
          title: "Success",
          description: "Logged in successfully",
        });
        navigate("/calendar");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: validation.email,
          password: validation.password,
          options: {
            data: {
              company_name: validation.company_name,
            },
            emailRedirectTo: `${window.location.origin}/calendar`,
          },
        });

        if (error) throw error;

        if (data.session) {
          navigate("/calendar");
        } else {
          navigate(`/auth/check-email?email=${encodeURIComponent(validation.email)}`, {
            state: { email: validation.email },
          });
        }
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation Error",
          description: error.errors[0].message,
          variant: "destructive",
        });
      } else if (isUnverifiedEmailError(error)) {
        setAuthNotice(authErrorMessage(error));
      } else {
        toast({
          title: "Sign in failed",
          description: authErrorMessage(error),
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="block mx-auto mb-4 w-fit">
            <img 
              src={bidboxLogo} 
              alt="BidBox Logo" 
              className="mx-auto"
              style={{ height: '124.8px' }}
            />
          </Link>
          <Link 
            to="/" 
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-4 mx-auto w-fit"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Homepage
          </Link>
          <p className="text-muted-foreground mt-4">
            {isLogin ? "Welcome back" : "Create your account"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {authNotice && (
              <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                {authNotice}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="company">Company Name</Label>
                <Input
                  id="company"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Your Company"
                />
              </div>
            )}

            <Button type="submit" className="w-full bg-bidbox-blue hover:bg-bidbox-blue/90 text-white" disabled={loading}>
              {loading ? "Loading..." : isLogin ? "Sign In" : "Sign Up"}
            </Button>
          </form>

          <div className="mt-4 text-center space-y-2">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-primary hover:underline"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
            
            {isLogin && (
              <ResendVerificationButton email={email} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ResendVerificationButton = ({ email }: { email: string }) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleResend = async () => {
    if (!email) {
      toast({
        title: "Email required",
        description: "Please enter your email address first",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
      });

      if (error) throw error;

      toast({
        title: "Email sent",
        description: "Check your inbox and Spam or Junk folder for the verification link.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to resend verification email",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleResend}
      disabled={loading}
      className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mx-auto"
    >
      <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Sending..." : "Resend verification email"}
    </button>
  );
};

export default Auth;
