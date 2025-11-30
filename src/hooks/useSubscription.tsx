import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

interface Subscription {
  id: string;
  profile_id: string;
  stripe_customer_id: string | null;
  subscription_type: string;
  status: string;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

interface UseSubscriptionReturn {
  subscription: Subscription | null;
  isSubscribed: boolean;
  isLifetime: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
}

export const useSubscription = (): UseSubscriptionReturn => {
  const { user, authReady } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("profile_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching subscription:", error);
        setSubscription(null);
      } else {
        setSubscription(data);
      }
    } catch (err) {
      console.error("Error in useSubscription:", err);
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authReady) {
      fetchSubscription();
    }
  }, [authReady, fetchSubscription]);

  const isSubscribed = subscription?.status === "active";
  const isLifetime = subscription?.subscription_type === "lifetime" && isSubscribed;

  return {
    subscription,
    isSubscribed,
    isLifetime,
    loading: !authReady || loading,
    refetch: fetchSubscription,
  };
};
