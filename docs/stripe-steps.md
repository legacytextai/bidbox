
# Stripe Integration Guide (React + Supabase + Edge Functions)

This guide documents a full Stripe integration using React as the frontend and Supabase (Edge Functions) as the backend. It supports both **one-time payments** and **subscriptions**, with secure webhook handling and data syncing.

---

## ✅ Step 1: Stripe Dashboard Setup

1. Go to [Stripe Dashboard – Products](https://dashboard.stripe.com/products).
2. **Create One-Time Product** (BidBox Early Access):
   - Product name: "Early Access Lifetime"
   - Pricing: One-time ($199.00)
   - Save and copy the **Price ID**
3. **Create Subscription Product** (Future - Tier 1):
   - Product name: "Tier 1"
   - Pricing: Recurring → Monthly ($49.00)
   - Status: Currently disabled in code
   - Save and copy the **Price ID**

**Note**: The Free tier (3 bid rooms) does not require a Stripe product.

---

## ✅ Step 2: Supabase Database Schema

### `profiles` table (if not already exists):

```sql
create table if not exists profiles (
  id uuid primary key references auth.users(id),
  email text,
  full_name text,
  created_at timestamp with time zone default timezone('utc', now())
);
```

### `subscriptions` table:

```sql
create table if not exists subscriptions (
  id uuid default uuid_generate_v4() primary key,
  profile_id uuid references profiles(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_type text,
  status text,
  valid_until timestamp with time zone,
  created_at timestamp with time zone default timezone('utc', now()),
  updated_at timestamp with time zone default timezone('utc', now())
);
```

### You should add the stripe_customer_id to the profiles table for the following reasons:
1. Customer Identification: The stripe_customer_id allows you to associate a Supabase user with their Stripe customer record. This is essential for tracking purchases, managing credits, and handling future transactions for the same user.
2. Simplified Checkout: With the stripe_customer_id stored, you can provide a smoother checkout experience for returning customers as their payment information can be pre-filled.
3. Payment History: It makes it easier to retrieve a user's purchase history directly from Stripe using their customer ID.
4. Following Best Practices: The stripe-steps.md document you provided explicitly includes stripe_customer_id in the profiles table schema as a recommended practice.
5. Future-Proofing: Even though you're currently focusing on one-time payments, having the stripe_customer_id in your schema will make it easier to implement subscriptions later if you decide to offer them.

---

## ✅ Step 3: Environment Variables

In Supabase dashboard → Functions → Settings, set:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` (after Step 6)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## ✅ Step 4: Create Checkout Session Edge Function

### `supabase/functions/create-checkout/index.ts`

```ts
import Stripe from 'https://esm.sh/stripe@14?target=denonext';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { priceId, profileId, returnUrl, email, planType } = await req.json();

    const session = await stripe.checkout.sessions.create({
      mode: planType === 'subscription' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: profileId,
      customer_email: email,
      metadata: { planType },
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?canceled=true`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: corsHeaders,
      status: 500,
    });
  }
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

---

## ✅ Step 5: React Integration

### `components/PurchaseButton.tsx`

```tsx
const handleClick = async () => {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_FUNCTION_URL}/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      priceId,
      planType,
      profileId,
      email,
      returnUrl,
    }),
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
};
```

---

## ✅ Step 6: Stripe Webhook Edge Function

### `supabase/functions/stripe-webhook/index.ts`

```ts
import Stripe from 'https://esm.sh/stripe@14?target=denonext';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req) => {
  const sig = req.headers.get('Stripe-Signature')!;
  const body = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    return new Response('Invalid signature', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    await supabase.from('subscriptions').upsert({
      profile_id: session.client_reference_id,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      subscription_type: session.metadata?.planType,
      status: session.subscription ? 'active' : 'completed',
    }, { onConflict: 'profile_id' });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

Then:

- Deploy: `supabase functions deploy stripe-webhook`
- Register webhook endpoint in Stripe and subscribe to:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`

---

## ✅ Step 7: Testing & Going Live

### Using Stripe CLI

```bash
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
stripe trigger checkout.session.completed
```

### Going Live Checklist

- Replace `sk_test_` keys with `sk_live_` keys
- Use live Price IDs
- Set return/cancel URLs to production domain
- Update CORS headers for production

---

## ✅ Done!

You now have:
- ✅ Stripe products and prices set up
- ✅ Secure Checkout Sessions via Supabase Edge Functions
- ✅ Real-time DB syncing with verified webhooks
- ✅ React frontend integration