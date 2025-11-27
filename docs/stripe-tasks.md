📋 Stripe Integration Task Breakdown
Based on stripe-steps.md and stripe.md, here is the complete task list:

Task 1 - STRIPE ACCOUNT & PRODUCT SETUP (Manual Steps)

1.1. Create Stripe Account (if needed)
Go to stripe.com and sign up
Complete account verification (business details, bank account)

1.2. Create "Early Access Lifetime" Product in Stripe Dashboard
Navigate to Products
Click "Add Product"
Product name: "Early Access Lifetime"
Description: "Lifetime unlimited bid rooms for BidBox"
Pricing: One-time payment → $199.00 USD
Save and copy the Price ID (e.g., price_1ABC...)

1.3. Create "Tier 1" Subscription Product (Future Use)
Add another product named "Tier 1"
Description: "Monthly subscription for unlimited bid rooms"
Pricing: Recurring → Monthly → $49.00 USD
Save and copy the Price ID for future use
Keep this product disabled until needed

1.4. Copy API Keys
Go to Developers → API Keys
Copy your Secret Key (sk_test_... for test mode)
You'll provide this when enabling Stripe in Lovable


Task 2 - ENABLE STRIPE IN LOVABLE

2.1. Enable Stripe Integration
Lovable will prompt you to enter your Stripe Secret Key
This stores the key securely as a backend secret

2.2. Add Additional Secrets
STRIPE_WEBHOOK_SECRET - Will be generated in Task 6


Task 3 - DATABASE SCHEMA UPDATES

3.1. Add stripe_customer_id column to profiles table

ALTER TABLE public.profiles 
ADD COLUMN stripe_customer_id TEXT;

3.2. Create subscriptions table

CREATE TABLE public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  valid_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

3.3. Create RLS policy for subscriptions table

CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = profile_id);
  
3.4. Create updated_at trigger for subscriptions table

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

  
Task 4 - CREATE create-checkout EDGE FUNCTION

4.1. Create edge function file
Location: supabase/functions/create-checkout/index.ts

4.2. Implement checkout session creation
Import Stripe library from esm.sh
Accept: priceId, profileId, email, planType, returnUrl
Create Stripe checkout session with mode payment (for lifetime) or subscription (future)
Include client_reference_id linking to user's profile ID
Return checkout URL for redirect

4.3. Configure function in config.toml
Add [functions.create-checkout] with verify_jwt = true (requires authentication)

4.4. Add CORS headers
Allow cross-origin requests from frontend


Task 5 - CREATE stripe-webhook EDGE FUNCTION

5.1. Create edge function file
Location: supabase/functions/stripe-webhook/index.ts

5.2. Implement webhook signature verification
Use stripe.webhooks.constructEventAsync with crypto provider
Verify using STRIPE_WEBHOOK_SECRET

5.3. Handle checkout.session.completed event
Extract client_reference_id (profile_id), customer (stripe_customer_id)
Upsert into subscriptions table with status completed for one-time payments
Also update profiles.stripe_customer_id

5.4. Configure function in config.toml
Add [functions.stripe-webhook] with verify_jwt = false (Stripe calls this publicly)


Task 6 - STRIPE WEBHOOK ENDPOINT SETUP (Manual Step)

6.1. Register webhook endpoint in Stripe Dashboard
Go to Developers → Webhooks → Add endpoint
URL: https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/stripe-webhook
Select events: checkout.session.completed

6.2. Copy Webhook Signing Secret
After creating endpoint, copy the "Signing secret" (whsec_...)
Add this as STRIPE_WEBHOOK_SECRET in Lovable secrets


Task 7 - FRONTEND: UPDATE PRICING COMPONENT

7.1. Update PricingMvp.tsx button logic
"Claim Lifetime Access" button: Call create-checkout edge function
"Start Free" button: Navigate to /auth for sign-up

7.2. Add checkout redirect logic
On successful edge function response, redirect to session.url
Handle loading state during checkout creation

7.3. Handle unauthenticated users
If not logged in, redirect to /auth first with return URL


Task 8 - FRONTEND: CREATE CHECKOUT RESULT PAGES

8.1. Create /checkout/success page
Display "Thank you for your purchase!" message
Verify session using query param session_id (optional)
Button to "Go to Dashboard"

8.2. Create /checkout/canceled page
Display "Payment was canceled" message
Link back to pricing page

8.3. Add routes in App.tsx
Add routes for /checkout/success and /checkout/canceled


Task 9 - FRONTEND: CREATE useSubscription HOOK

9.1. Create hook file
Location: src/hooks/useSubscription.ts

9.2. Implement subscription fetching
Query subscriptions table for current user
Return { subscription, isLoading, isPaid, planType }

9.3. Handle edge cases
User not logged in: return null subscription
No subscription record: user is on free tier


Task 10 - FRONTEND: ENFORCE FREE TIER LIMIT

10.1. Update project creation logic in NewProject.tsx
Before allowing form submission, check user's subscription
Count existing projects for user
If count >= 3 and not paid, show upgrade prompt

10.2. Create upgrade prompt component
Display when free user hits 3-project limit
"You've reached your free limit. Upgrade to Lifetime for unlimited bid rooms."
Button to navigate to pricing

10.3. Update dashboard to show remaining projects
Display "X of 3 bid rooms used" for free users
Display "Unlimited" badge for paid users


Task 11 - FRONTEND: ADD SUBSCRIPTION STATUS DISPLAY

11.1. Update Settings page
Show current plan: "Free" or "Early Access Lifetime"
Show subscription status

11.2. Add status badge to dashboard header (optional)
Display "Lifetime" badge for paid users


Task 12 - TESTING IN STRIPE TEST MODE

12.1. Test checkout flow
Use test card: 4242 4242 4242 4242
Any future expiration date, any CVC

12.2. Verify webhook receives event
Check Stripe Dashboard → Webhooks → Recent events
Confirm checkout.session.completed received

12.3. Verify database updates
Check subscriptions table has new record
Check profiles.stripe_customer_id is populated

12.4. Test free tier limit
Create 3 projects as free user
Verify 4th project shows upgrade prompt
Purchase lifetime, verify unlimited access


Task 13 - GO-LIVE CHECKLIST (Manual Steps)

13.1. Switch to live mode in Stripe
Replace sk_test_ with sk_live_ key in Lovable secrets
Create new webhook endpoint with live URL
Update STRIPE_WEBHOOK_SECRET with live signing secret

13.2. Use live Price IDs
Update code to use production Price IDs (or use environment variable)

13.3. Final testing
Complete one real purchase to verify end-to-end flow


🔄 Summary of Components
Component	Type	Owner
Stripe products/prices	Stripe Dashboard	You (manual)
Stripe API keys	Backend secret	Lovable
stripe_customer_id column	Migration	Lovable
subscriptions table	Migration	Lovable
create-checkout function	Edge Function	Lovable
stripe-webhook function	Edge Function	Lovable
Webhook endpoint	Stripe Dashboard	You (manual)
PricingMvp.tsx updates	Frontend	Lovable
Checkout success/cancel pages	Frontend	Lovable
useSubscription hook	Frontend	Lovable
Free tier enforcement	Frontend	Lovable
Settings page updates	Frontend	Lovable

