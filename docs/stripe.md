# **How to integrate Stripe** 

- **PAYMENT LINKS:** The most straightforward approach is to use Stripe’s built-in Payment Links for quick and easy checkout. 

### Why Payment Links:

* Easiest to Implement: Creates the smallest integration footprint in your codebase  
* No Complex Backend Logic: Avoids complicated payment flow handling  
* Minimal Security Risk: Payment details handled entirely by Stripe, not your app  
* Quick Time-to-Market: Can be implemented in hours rather than days

### Implementation Plan:

1. For One-Time Payments (Credits Package):  
   * Create a Supabase Edge Function to generate a Stripe checkout session  
   * When a user hits their generation limit, offer a purchase option  
   * After successful payment, update their credits in the profiles table  
2. For Subscription Model:  
   * Create subscription plans in Stripe Dashboard  
   * Add a subscription status field to your profiles table  
   * Implement a subscription verification edge function  
   * Use that status to increase/remove generation limits

### Why Not Webhooks or Direct API:

* Webhooks: Requires complex event handling and additional security setup  
* Direct API: Higher security risk and more complex integration

### Technical Requirements:

1. Database Changes:  
   * Add credits and/or subscription\_tier fields to your profiles table  
   * Create a transactions table if you want to track purchase history  
2. Edge Functions:  
   * create-checkout: Generate checkout session URL  
   * verify-payment: Check payment status (optional)  
3. UI Updates:  
   * Add a pricing page  
   * Update rate limit messaging to offer paid options  
   * Create a user dashboard section to show remaining credits/subscription status

This approach provides the simplest path to monetization while leveraging your existing Supabase infrastructure and creating minimal technical debt.  
		**Required docs:** 

[https://docs.stripe.com/api/payment-link/create.md](https://docs.stripe.com/api/payment-link/create.md)   
[https://docs.stripe.com/api/payment-link/update.md](https://docs.stripe.com/api/payment-link/update.md)

- **WEBHOOKS AND API:** For advanced setups, including webhooks and subscription handling, Lovable recommends integrating Supabase for secure and efficient payment processing.

## **Steps to using webhooks:**

1. **Give Lovable the example of a template to integrate Stripe Webhooks** 

`// Follow this setup guide to integrate the Deno language server with your editor:`  
`// https://deno.land/manual/getting_started/setup_your_environment`  
`// This enables autocomplete, go to definition, etc.`

`// Import via bare specifier thanks to the import_map.json file.`  
`import Stripe from 'https://esm.sh/stripe@14?target=denonext'`

`const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY') as string, {`  
  `// This is needed to use the Fetch API rather than relying on the Node http`  
  `// package.`  
  `apiVersion: '2024-11-20'`  
`})`  
`// This is needed in order to use the Web Crypto API in Deno.`  
`const cryptoProvider = Stripe.createSubtleCryptoProvider()`

`console.log('Hello from Stripe Webhook!')`

`Deno.serve(async (request) => {`  
  `const signature = request.headers.get('Stripe-Signature')`

  `// First step is to verify the event. The .text() method must be used as the`  
  `// verification relies on the raw request body rather than the parsed JSON.`  
  `const body = await request.text()`  
  `let receivedEvent`  
  `try {`  
    `receivedEvent = await stripe.webhooks.constructEventAsync(`  
      `body,`  
      `signature!,`  
      `Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')!,`  
      `undefined,`  
      `cryptoProvider`  
    `)`  
  `} catch (err) {`  
    `return new Response(err.message, { status: 400 })`  
  `}`  
  ``console.log(`🔔 Event received: ${receivedEvent.id}`)``  
  `return new Response(JSON.stringify({ ok: true }), { status: 200 })`  
`});`

2. **Obtain required documentation:** 

You can find all Stripe AI friendly format docs on [https://docs.stripe.com/llms.txt](https://docs.stripe.com/llms.txt), but the ones most relevant for you would be: 

[https://docs.stripe.com/checkout/quickstart.md](https://docs.stripe.com/checkout/quickstart.md)   
[https://docs.stripe.com/payments/subscriptions.md](https://docs.stripe.com/payments/subscriptions.md)   
[https://docs.stripe.com/api/checkout/sessions.md](https://docs.stripe.com/api/checkout/sessions.md)  
[https://docs.stripe.com/api/checkout/sessions/create.md](https://docs.stripe.com/api/checkout/sessions/create.md)   
[https://docs.stripe.com/api/checkout/sessions/update.md](https://docs.stripe.com/api/checkout/sessions/update.md)  

[https://docs.stripe.com/api/checkout/sessions](https://docs.stripe.com/api/checkout/sessions) IS THE KEY STRIPE DOCUMENT\! 

A Checkout Session represents your customer’s session as they pay for one-time purchases or subscriptions through [Checkout](https://docs.stripe.com/payments/checkout) or [Payment Links](https://docs.stripe.com/payments/payment-links). We recommend creating a new Session each time your customer attempts to pay.  
Once payment is successful, the Checkout Session will contain a reference to the [Customer](https://docs.stripe.com/api/customers), and either the successful [PaymentIntent](https://docs.stripe.com/api/payment_intents) or an active [Subscription](https://docs.stripe.com/api/subscriptions).  
You can create a Checkout Session on your server and redirect to its URL to begin Checkout.  
Related guide: [Checkout quickstart](https://docs.stripe.com/checkout/quickstart)  
Endpoints  
[POST/v1/checkout/sessions](https://docs.stripe.com/api/checkout/sessions/create)[POST/v1/checkout/sessions/:id](https://docs.stripe.com/api/checkout/sessions/update)[GET/v1/checkout/sessions/:id](https://docs.stripe.com/api/checkout/sessions/retrieve)[GET/v1/checkout/sessions/:id/line\_items](https://docs.stripe.com/api/checkout/sessions/line_items)[GET/v1/checkout/sessions](https://docs.stripe.com/api/checkout/sessions/list)[POST/v1/checkout/sessions/:id/expire](https://docs.stripe.com/api/checkout/sessions/expire)

# [**The Checkout Session object**](https://docs.stripe.com/api/checkout/sessions/object) 

### **Attributes**

* #### **id**string

* Unique identifier for the object.

* #### **automatic\_tax**object

* Details on the state of automatic tax for the session, including the status of the latest tax calculation.  
* Show child attributes

* #### **client\_reference\_id**nullable string

* A unique string to reference the Checkout Session. This can be a customer ID, a cart ID, or similar, and can be used to reconcile the Session with your internal systems.

* #### **currency**nullable enum

* Three-letter [ISO currency code](https://www.iso.org/iso-4217-currency-codes.html), in lowercase. Must be a [supported currency](https://stripe.com/docs/currencies).

* #### **customer**nullable stringExpandable

* The ID of the customer for this Session. For Checkout Sessions in subscription mode or Checkout Sessions with customer\_creation set as always in payment mode, Checkout will create a new customer object based on information provided during the payment flow unless an existing customer was provided when the Session was created.

* #### **customer\_email**nullable string

* If provided, this value will be used when the Customer object is created. If not provided, customers will be asked to enter their email address. Use this parameter to prefill customer data if you already have an email on file. To access information about the customer once the payment flow is complete, use the customer attribute.

* #### **line\_items**nullable objectExpandable

* The line items purchased by the customer.  
* Show child attributes

* #### **metadata**nullable object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format.

* #### **mode**enum

* The mode of the Checkout Session.  
* Possible enum values

| payment Accept one-time payments for cards, iDEAL, and more. |
| :---- |
| setup Save payment details to charge your customers later. |
| subscription Use Stripe Billing to set up fixed-price subscriptions. |

* #### **payment\_intent**nullable stringExpandable

* The ID of the PaymentIntent for Checkout Sessions in payment mode. You can’t confirm or cancel the PaymentIntent for a Checkout Session. To cancel, [expire the Checkout Session](https://docs.stripe.com/api/checkout/sessions/expire) instead.

* #### **payment\_status**enum

* The payment status of the Checkout Session, one of paid, unpaid, or no\_payment\_required. You can use this value to decide when to fulfill your customer’s order.  
* Possible enum values

| no\_payment\_required The payment is delayed to a future date, or the Checkout Session is in setup mode and doesn’t require a payment at this time. |
| :---- |
| paid The payment funds are available in your account. |
| unpaid The payment funds are not yet available in your account. |

* #### **return\_url**nullable string

* Applies to Checkout Sessions with ui\_mode: embedded or ui\_mode: custom. The URL to redirect your customer back to after they authenticate or cancel their payment on the payment method’s app or site.

* #### **status**nullable enum

* The status of the Checkout Session, one of open, complete, or expired.  
* Possible enum values

| complete The checkout session is complete. Payment processing may still be in progress |
| :---- |
| expired The checkout session has expired. No further processing will occur |
| open The checkout session is still in progress. Payment processing has not started |

* #### **success\_url**nullable string

* The URL the customer will be directed to after the payment or subscription creation is successful.

* #### **ui\_mode**nullable enum

* The UI mode of the Session. Defaults to hosted.  
* Possible enum values

| custom The Checkout Session will be displayed using [embedded components](https://docs.stripe.com/checkout/custom/quickstart) on your website |
| :---- |
| embedded The Checkout Session will be displayed as an embedded form on your website. |
| hosted The Checkout Session will be displayed on a hosted page that customers will be redirected to. |

* #### **url**nullable string

* The URL to the Checkout Session. Applies to Checkout Sessions with ui\_mode: hosted. Redirect customers to this URL to take them to Checkout. If you’re using [Custom Domains](https://docs.stripe.com/payments/checkout/custom-domains), the URL will use your subdomain. Otherwise, it’ll use checkout.stripe.com. This value is only present when the session is active.

### **More attributes**

### Expand all

* #### **object**string

* #### **adaptive\_pricing**nullable object

* #### **after\_expiration**nullable object

* #### **allow\_promotion\_codes**nullable boolean

* #### **amount\_subtotal**nullable integer

* #### **amount\_total**nullable integer

* #### **billing\_address\_collection**nullable enum

* #### **cancel\_url**nullable string

* #### **client\_secret**nullable string

* #### **collected\_information**nullable object

* #### **consent**nullable object

* #### **consent\_collection**nullable object

* #### **created**timestamp

* #### **currency\_conversion**nullable object

* #### **custom\_fields**array of objects

* #### **custom\_text**object

* #### **customer\_creation**nullable enum

* #### **customer\_details**nullable object

* #### **discounts**nullable array of objects

* #### **expires\_at**timestamp

* #### **invoice**nullable stringExpandable

* #### **invoice\_creation**nullable object

* #### **livemode**boolean

* #### **locale**nullable enum

* #### **optional\_items**nullable array of objectsExpandable

* #### **payment\_link**nullable stringExpandable

* #### **payment\_method\_collection**nullable enum

* #### **payment\_method\_configuration\_details**nullable object

* #### **payment\_method\_options**nullable object

* #### **payment\_method\_types**array of strings

* #### **permissions**nullable object

* #### **phone\_number\_collection**nullable object

* #### **presentment\_details**nullable objectPreview feature

* #### **recovered\_from**nullable string

* #### **redirect\_on\_completion**nullable enum

* #### **saved\_payment\_method\_options**nullable object

* #### **setup\_intent**nullable stringExpandable

* #### **shipping\_address\_collection**nullable object

* #### **shipping\_cost**nullable object

* #### **shipping\_options**array of objects

* #### **submit\_type**nullable enum

* #### **subscription**nullable stringExpandable

* #### **tax\_id\_collection**nullable object

* #### **total\_details**nullable object

* #### **wallet\_options**nullable object

The Checkout Session object  
{  
 "id": "cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",  
 "object": "checkout.session",  
 "after\_expiration": null,  
 "allow\_promotion\_codes": null,  
 "amount\_subtotal": 2198,  
 "amount\_total": 2198,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_address\_collection": null,  
 "cancel\_url": null,  
 "client\_reference\_id": null,  
 "consent": null,  
 "consent\_collection": null,  
 "created": 1679600215,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer": null,  
 "customer\_creation": "if\_required",  
 "customer\_details": null,  
 "customer\_email": null,  
 "expires\_at": 1679686615,  
 "invoice": null,  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "locale": null,  
 "metadata": {},  
 "mode": "payment",  
 "payment\_intent": null,  
 "payment\_link": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_options": {},  
 "payment\_method\_types": \[  
   "card"  
 \],  
 "payment\_status": "unpaid",  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "recovered\_from": null,  
 "setup\_intent": null,  
 "shipping\_address\_collection": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "shipping\_options": \[\],  
 "status": "open",  
 "submit\_type": null,  
 "subscription": null,  
 "success\_url": "https://example.com/success",  
 "total\_details": {  
   "amount\_discount": 0,  
   "amount\_shipping": 0,  
   "amount\_tax": 0  
 },  
 "url": "https://checkout.stripe.com/c/pay/cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u\#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"  
}

# [**Create a Checkout Session**](https://docs.stripe.com/api/checkout/sessions/create) 

Creates a Checkout Session object.

### **Parameters**

* #### **automatic\_tax**object

* Settings for automatic tax lookup for this session and resulting payments, invoices, and subscriptions.  
* Show child parameters

* #### **client\_reference\_id**string

* A unique string to reference the Checkout Session. This can be a customer ID, a cart ID, or similar, and can be used to reconcile the session with your internal systems.

* #### **customer**string

* ID of an existing Customer, if one exists. In payment mode, the customer’s most recently saved card payment method will be used to prefill the email, name, card details, and billing address on the Checkout page. In subscription mode, the customer’s [default payment method](https://docs.stripe.com/api/customers/update#update_customer-invoice_settings-default_payment_method) will be used if it’s a card, otherwise the most recently saved card will be used. A valid billing address, billing name and billing email are required on the payment method for Checkout to prefill the customer’s card details.  
  If the Customer already has a valid [email](https://docs.stripe.com/api/customers/object#customer_object-email) set, the email will be prefilled and not editable in Checkout. If the Customer does not have a valid email, Checkout will set the email entered during the session on the Customer.  
  If blank for Checkout Sessions in subscription mode or with customer\_creation set as always in payment mode, Checkout will create a new Customer object based on information provided during the payment flow.  
  You can set [payment\_intent\_data.setup\_future\_usage](https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-payment_intent_data-setup_future_usage) to have Checkout automatically attach the payment method to the Customer you pass in for future reuse.

* #### **customer\_email**string

* If provided, this value will be used when the Customer object is created. If not provided, customers will be asked to enter their email address. Use this parameter to prefill customer data if you already have an email on file. To access information about the customer once a session is complete, use the customer field.

* #### **line\_items**array of objectsRequired for payment and subscription mode

* A list of items the customer is purchasing. Use this parameter to pass one-time or recurring [Prices](https://docs.stripe.com/api/prices).  
  For payment mode, there is a maximum of 100 line items, however it is recommended to consolidate line items if there are more than a few dozen.  
  For subscription mode, there is a maximum of 20 line items with recurring Prices and 20 line items with one-time Prices. Line items with one-time Prices will be on the initial invoice only.  
* Show child parameters

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

* #### **mode**enumRequired

* The mode of the Checkout Session. Pass subscription if the Checkout Session includes at least one recurring item.  
* Possible enum values

| payment Accept one-time payments for cards, iDEAL, and more. |
| :---- |
| setup Save payment details to charge your customers later. |
| subscription Use Stripe Billing to set up fixed-price subscriptions. |

* #### **return\_url**stringRequired conditionally

* The URL to redirect your customer back to after they authenticate or cancel their payment on the payment method’s app or site. This parameter is required if ui\_mode is embedded or custom and redirect-based payment methods are enabled on the session.

* #### **success\_url**stringRequired conditionally

* The URL to which Stripe should send customers when payment or setup is complete. This parameter is not allowed if ui\_mode is embedded or custom. If you’d like to use information from the successful Checkout Session on your page, read the guide on [customizing your success page](https://docs.stripe.com/payments/checkout/custom-success-page).

* #### **ui\_mode**enum

* The UI mode of the Session. Defaults to hosted.  
* Possible enum values

| custom The Checkout Session will be displayed using [embedded components](https://docs.stripe.com/checkout/custom/quickstart) on your website |
| :---- |
| embedded The Checkout Session will be displayed as an embedded form on your website. |
| hosted The Checkout Session will be displayed on a hosted page that customers will be redirected to. |

### **More parameters**

### Expand all

* #### **adaptive\_pricing**object

* #### **after\_expiration**object

* #### **allow\_promotion\_codes**boolean

* #### **billing\_address\_collection**enum

* #### **cancel\_url**string

* #### **consent\_collection**object

* #### **currency**enumRequired conditionally

* #### **custom\_fields**array of objects

* #### **custom\_text**object

* #### **customer\_creation**enum

* #### **customer\_update**object

* #### **discounts**array of objects

* #### **expires\_at**timestamp

* #### **invoice\_creation**object

* #### **locale**enum

* #### **optional\_items**array of objects

* #### **payment\_intent\_data**object

* #### **payment\_method\_collection**enum

* #### **payment\_method\_configuration**string

* #### **payment\_method\_data**object

* #### **payment\_method\_options**object

* #### **payment\_method\_types**array of enums

* #### **permissions**object

* #### **phone\_number\_collection**object

* #### **redirect\_on\_completion**enum

* #### **saved\_payment\_method\_options**object

* #### **setup\_intent\_data**object

* #### **shipping\_address\_collection**object

* #### **shipping\_options**array of objects

* #### **submit\_type**enum

* #### **subscription\_data**object

* #### **tax\_id\_collection**object

* #### **wallet\_options**object

### **Returns**

Returns a Checkout Session object.  
POST /v1/checkout/sessions  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/checkout/sessions \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \--data-urlencode success\_url="https://example.com/success" \\  
 \-d "line\_items\[0\]\[price\]"\=price\_1MotwRLkdIwHu7ixYcPLm5uZ \\  
 \-d "line\_items\[0\]\[quantity\]"\=2 \\  
 \-d mode=payment  
Response  
{  
 "id": "cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",  
 "object": "checkout.session",  
 "after\_expiration": null,  
 "allow\_promotion\_codes": null,  
 "amount\_subtotal": 2198,  
 "amount\_total": 2198,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_address\_collection": null,  
 "cancel\_url": null,  
 "client\_reference\_id": null,  
 "consent": null,  
 "consent\_collection": null,  
 "created": 1679600215,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer": null,  
 "customer\_creation": "if\_required",  
 "customer\_details": null,  
 "customer\_email": null,  
 "expires\_at": 1679686615,  
 "invoice": null,  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "locale": null,  
 "metadata": {},  
 "mode": "payment",  
 "payment\_intent": null,  
 "payment\_link": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_options": {},  
 "payment\_method\_types": \[  
   "card"  
 \],  
 "payment\_status": "unpaid",  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "recovered\_from": null,  
 "setup\_intent": null,  
 "shipping\_address\_collection": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "shipping\_options": \[\],  
 "status": "open",  
 "submit\_type": null,  
 "subscription": null,  
 "success\_url": "https://example.com/success",  
 "total\_details": {  
   "amount\_discount": 0,  
   "amount\_shipping": 0,  
   "amount\_tax": 0  
 },  
 "url": "https://checkout.stripe.com/c/pay/cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u\#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"  
}

# [**Update a Checkout Session**](https://docs.stripe.com/api/checkout/sessions/update) 

Updates a Checkout Session object.  
Related guide: [Dynamically update Checkout](https://docs.stripe.com/payments/checkout/dynamic-updates)

### **Parameters**

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

### **More parameters**

### Expand all

* #### **collected\_information**object

* #### **shipping\_options**array of objects

### **Returns**

Returns a Checkout Session object.  
POST /v1/checkout/sessions/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/checkout/sessions/cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "metadata\[order\_id\]"\=6735  
Response  
{  
 "id": "cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",  
 "object": "checkout.session",  
 "after\_expiration": null,  
 "allow\_promotion\_codes": null,  
 "amount\_subtotal": 2198,  
 "amount\_total": 2198,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_address\_collection": null,  
 "cancel\_url": null,  
 "client\_reference\_id": null,  
 "consent": null,  
 "consent\_collection": null,  
 "created": 1679600215,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer": null,  
 "customer\_creation": "if\_required",  
 "customer\_details": null,  
 "customer\_email": null,  
 "expires\_at": 1679686615,  
 "invoice": null,  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "locale": null,  
 "metadata": {  
   "order\_id": "6735"  
 },  
 "mode": "payment",  
 "payment\_intent": null,  
 "payment\_link": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_options": {},  
 "payment\_method\_types": \[  
   "card"  
 \],  
 "payment\_status": "unpaid",  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "recovered\_from": null,  
 "setup\_intent": null,  
 "shipping\_address\_collection": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "shipping\_options": \[\],  
 "status": "open",  
 "submit\_type": null,  
 "subscription": null,  
 "success\_url": "https://example.com/success",  
 "total\_details": {  
   "amount\_discount": 0,  
   "amount\_shipping": 0,  
   "amount\_tax": 0  
 },  
 "url": "https://checkout.stripe.com/c/pay/cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u\#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"  
}

# [**Retrieve a Checkout Session**](https://docs.stripe.com/api/checkout/sessions/retrieve) 

Retrieves a Checkout Session object.

### **Parameters**

No parameters.

### **Returns**

Returns a Checkout Session object.  
GET /v1/checkout/sessions/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/checkout/sessions/cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",  
 "object": "checkout.session",  
 "after\_expiration": null,  
 "allow\_promotion\_codes": null,  
 "amount\_subtotal": 2198,  
 "amount\_total": 2198,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_address\_collection": null,  
 "cancel\_url": null,  
 "client\_reference\_id": null,  
 "consent": null,  
 "consent\_collection": null,  
 "created": 1679600215,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer": null,  
 "customer\_creation": "if\_required",  
 "customer\_details": null,  
 "customer\_email": null,  
 "expires\_at": 1679686615,  
 "invoice": null,  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "locale": null,  
 "metadata": {},  
 "mode": "payment",  
 "payment\_intent": null,  
 "payment\_link": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_options": {},  
 "payment\_method\_types": \[  
   "card"  
 \],  
 "payment\_status": "unpaid",  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "recovered\_from": null,  
 "setup\_intent": null,  
 "shipping\_address\_collection": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "shipping\_options": \[\],  
 "status": "open",  
 "submit\_type": null,  
 "subscription": null,  
 "success\_url": "https://example.com/success",  
 "total\_details": {  
   "amount\_discount": 0,  
   "amount\_shipping": 0,  
   "amount\_tax": 0  
 },  
 "url": "https://checkout.stripe.com/c/pay/cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u\#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"  
}

# [**Retrieve a Checkout Session's line items**](https://docs.stripe.com/api/checkout/sessions/line_items) 

When retrieving a Checkout Session, there is an includable **line\_items** property containing the first handful of those items. There is also a URL where you can retrieve the full (paginated) list of line items.

### **Parameters**

No parameters.

### **More parameters**

### Expand all

* #### **ending\_before**string

* #### **limit**integer

* #### **starting\_after**string

### **Returns**

A dictionary with a data property that contains an array of up to limit Checkout Session line items, starting after Line Item starting\_after. Each entry in the array is a separate Line Item object. If no more line items are available, the resulting array will be empty.  
GET /v1/checkout/sessions/:id/line\_items  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/checkout/sessions/cs\_test\_a1enSAC01IA3Ps2vL32mNoWKMCNmmfUGTeEeHXI5tLCvyFNGsdG2UNA7mr/line\_items \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "object": "list",  
 "data": \[  
   {  
     "id": "li\_1N4BEoLkdIwHu7ixWtXug1yk",  
     "object": "item",  
     "amount\_discount": 0,  
     "amount\_subtotal": 2198,  
     "amount\_tax": 0,  
     "amount\_total": 2198,  
     "currency": "usd",  
     "description": "T-shirt",  
     "price": {  
       "id": "price\_1N4AEsLkdIwHu7ix7Ssho8Cl",  
       "object": "price",  
       "active": true,  
       "billing\_scheme": "per\_unit",  
       "created": 1683237782,  
       "currency": "usd",  
       "custom\_unit\_amount": null,  
       "livemode": false,  
       "lookup\_key": null,  
       "metadata": {},  
       "nickname": null,  
       "product": "prod\_NppuJWzzNnD5Ut",  
       "recurring": null,  
       "tax\_behavior": "unspecified",  
       "tiers\_mode": null,  
       "transform\_quantity": null,  
       "type": "one\_time",  
       "unit\_amount": 1099,  
       "unit\_amount\_decimal": "1099"  
     },  
     "quantity": 2  
   }  
 \],  
 "has\_more": false,  
 "url": "/v1/checkout/sessions/cs\_test\_a1enSAC01IA3Ps2vL32mNoWKMCNmmfUGTeEeHXI5tLCvyFNGsdG2UNA7mr/line\_items"  
}

# [**List all Checkout Sessions**](https://docs.stripe.com/api/checkout/sessions/list) 

Returns a list of Checkout Sessions.

### **Parameters**

* #### **payment\_intent**string

* Only return the Checkout Session for the PaymentIntent specified.

* #### **subscription**string

* Only return the Checkout Session for the subscription specified.

### **More parameters**

### Expand all

* #### **created**object

* #### **customer**string

* #### **customer\_details**object

* #### **ending\_before**string

* #### **limit**integer

* #### **payment\_link**string

* #### **starting\_after**string

* #### **status**enum

### **Returns**

A dictionary with a data property that contains an array of up to limit Checkout Sessions, starting after Checkout Session starting\_after. Each entry in the array is a separate Checkout Session object. If no more Checkout Sessions are available, the resulting array will be empty.  
GET /v1/checkout/sessions  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-G https://api.stripe.com/v1/checkout/sessions \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d limit=3  
Response  
{  
 "object": "list",  
 "url": "/v1/checkout/sessions",  
 "has\_more": false,  
 "data": \[  
   {  
     "id": "cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",  
     "object": "checkout.session",  
     "after\_expiration": null,  
     "allow\_promotion\_codes": null,  
     "amount\_subtotal": 2198,  
     "amount\_total": 2198,  
     "automatic\_tax": {  
       "enabled": false,  
       "liability": null,  
       "status": null  
     },  
     "billing\_address\_collection": null,  
     "cancel\_url": null,  
     "client\_reference\_id": null,  
     "consent": null,  
     "consent\_collection": null,  
     "created": 1679600215,  
     "currency": "usd",  
     "custom\_fields": \[\],  
     "custom\_text": {  
       "shipping\_address": null,  
       "submit": null  
     },  
     "customer": null,  
     "customer\_creation": "if\_required",  
     "customer\_details": null,  
     "customer\_email": null,  
     "expires\_at": 1679686615,  
     "invoice": null,  
     "invoice\_creation": {  
       "enabled": false,  
       "invoice\_data": {  
         "account\_tax\_ids": null,  
         "custom\_fields": null,  
         "description": null,  
         "footer": null,  
         "issuer": null,  
         "metadata": {},  
         "rendering\_options": null  
       }  
     },  
     "livemode": false,  
     "locale": null,  
     "metadata": {},  
     "mode": "payment",  
     "payment\_intent": null,  
     "payment\_link": null,  
     "payment\_method\_collection": "always",  
     "payment\_method\_options": {},  
     "payment\_method\_types": \[  
       "card"  
     \],  
     "payment\_status": "unpaid",  
     "phone\_number\_collection": {  
       "enabled": false  
     },  
     "recovered\_from": null,  
     "setup\_intent": null,  
     "shipping\_address\_collection": null,  
     "shipping\_cost": null,  
     "shipping\_details": null,  
     "shipping\_options": \[\],  
     "status": "open",  
     "submit\_type": null,  
     "subscription": null,  
     "success\_url": "https://example.com/success",  
     "total\_details": {  
       "amount\_discount": 0,  
       "amount\_shipping": 0,  
       "amount\_tax": 0  
     },  
     "url": "https://checkout.stripe.com/c/pay/cs\_test\_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u\#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"  
   }  
 \]  
}

# [**Expire a Checkout Session**](https://docs.stripe.com/api/checkout/sessions/expire) 

A Checkout Session can be expired when it is in one of these statuses: open  
After it expires, a customer can’t complete a Checkout Session and customers loading the Checkout Session see a message saying the Checkout Session is expired.

### **Parameters**

No parameters.

### **Returns**

Returns a Checkout Session object if the expiration succeeded. Returns an error if the Checkout Session has already expired or isn’t in an expireable state.  
POST /v1/checkout/sessions/:id/expire  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X POST https://api.stripe.com/v1/checkout/sessions/cs\_test\_a1Ae6ClgOkjygKwrf9B3L6ITtUuZW4Xx9FivL6DZYoYFdfAefQxsYpJJd3/expire \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "cs\_test\_a1Ae6ClgOkjygKwrf9B3L6ITtUuZW4Xx9FivL6DZYoYFdfAefQxsYpJJd3",  
 "object": "checkout.session",  
 "after\_expiration": null,  
 "allow\_promotion\_codes": null,  
 "amount\_subtotal": 2198,  
 "amount\_total": 2198,  
 "automatic\_tax": {  
   "enabled": false,  
   "status": null  
 },  
 "billing\_address\_collection": null,  
 "cancel\_url": null,  
 "client\_reference\_id": null,  
 "consent": null,  
 "consent\_collection": null,  
 "created": 1679434412,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer": null,  
 "customer\_creation": "if\_required",  
 "customer\_details": null,  
 "customer\_email": null,  
 "expires\_at": 1679520812,  
 "invoice": null,  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "locale": null,  
 "metadata": {},  
 "mode": "payment",  
 "payment\_intent": null,  
 "payment\_link": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_options": {},  
 "payment\_method\_types": \[  
   "card"  
 \],  
 "payment\_status": "unpaid",  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "recovered\_from": null,  
 "setup\_intent": null,  
 "shipping\_address\_collection": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "shipping\_options": \[\],  
 "status": "expired",  
 "submit\_type": null,  
 "subscription": null,  
 "success\_url": "https://example.com/success",  
 "total\_details": {  
   "amount\_discount": 0,  
   "amount\_shipping": 0,  
   "amount\_tax": 0  
 },  
 "url": null  
}

# [**Payment Link**](https://docs.stripe.com/api/payment-link) 

A payment link is a shareable URL that will take your customers to a hosted payment page. A payment link can be shared and used multiple times.  
When a customer opens a payment link it will open a new [checkout session](https://docs.stripe.com/api/checkout/sessions) to render the payment page. You can use [checkout session events](https://docs.stripe.com/api/events/types#event_types-checkout.session.completed) to track payments through payment links.  
Related guide: [Payment Links API](https://docs.stripe.com/payment-links)

Was this section helpful?YesNo  
Endpoints  
[POST/v1/payment\_links](https://docs.stripe.com/api/payment-link/create)[POST/v1/payment\_links/:id](https://docs.stripe.com/api/payment-link/update)[GET/v1/payment\_links/:id/line\_items](https://docs.stripe.com/api/payment-link/retrieve-line-items)[GET/v1/payment\_links/:id](https://docs.stripe.com/api/payment-link/retrieve)[GET/v1/payment\_links](https://docs.stripe.com/api/payment-link/list)

# [**The Payment Link object**](https://docs.stripe.com/api/payment-link/object) 

### **Attributes**

* #### **id**string

* Unique identifier for the object.

* #### **active**boolean

* Whether the payment link’s url is active. If false, customers visiting the URL will be shown a page saying that the link has been deactivated.

* #### **line\_items**objectExpandable

* The line items representing what is being sold.  
* Show child attributes

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format.

* #### **url**string

* The public URL that can be shared with customers.

### **More attributes**

### Expand all

* #### **object**string

* #### **after\_completion**object

* #### **allow\_promotion\_codes**boolean

* #### **application**nullable stringExpandableConnect only

* #### **application\_fee\_amount**nullable integerConnect only

* #### **application\_fee\_percent**nullable floatConnect only

* #### **automatic\_tax**object

* #### **billing\_address\_collection**enum

* #### **consent\_collection**nullable object

* #### **currency**enum

* #### **custom\_fields**array of objects

* #### **custom\_text**object

* #### **customer\_creation**enum

* #### **inactive\_message**nullable string

* #### **invoice\_creation**nullable object

* #### **livemode**boolean

* #### **on\_behalf\_of**nullable stringExpandableConnect only

* #### **optional\_items**nullable array of objectsExpandable

* #### **payment\_intent\_data**nullable object

* #### **payment\_method\_collection**enum

* #### **payment\_method\_types**nullable array of enums

* #### **phone\_number\_collection**object

* #### **restrictions**nullable object

* #### **shipping\_address\_collection**nullable object

* #### **shipping\_options**array of objects

* #### **submit\_type**enum

* #### **subscription\_data**nullable object

* #### **tax\_id\_collection**object

* #### **transfer\_data**nullable objectConnect only

The Payment Link object  
{  
 "id": "plink\_1MoC3ULkdIwHu7ixZjtGpVl2",  
 "object": "payment\_link",  
 "active": true,  
 "after\_completion": {  
   "hosted\_confirmation": {  
     "custom\_message": null  
   },  
   "type": "hosted\_confirmation"  
 },  
 "allow\_promotion\_codes": false,  
 "application\_fee\_amount": null,  
 "application\_fee\_percent": null,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null  
 },  
 "billing\_address\_collection": "auto",  
 "consent\_collection": null,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer\_creation": "if\_required",  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "metadata": {},  
 "on\_behalf\_of": null,  
 "payment\_intent\_data": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_types": null,  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "shipping\_address\_collection": null,  
 "shipping\_options": \[\],  
 "submit\_type": "auto",  
 "subscription\_data": {  
   "description": null,  
   "invoice\_settings": {  
     "issuer": {  
       "type": "self"  
     }  
   },  
   "trial\_period\_days": null  
 },  
 "tax\_id\_collection": {  
   "enabled": false  
 },  
 "transfer\_data": null,  
 "url": "https://buy.stripe.com/test\_cN25nr0iZ7bUa7meUY"  
}

# [**Create a payment link**](https://docs.stripe.com/api/payment-link/create) 

Creates a payment link.

### **Parameters**

* #### **line\_items**array of objectsRequired

* The line items representing what is being sold. Each line item represents an item being sold. Up to 20 line items are supported.  
* Show child parameters

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata. Metadata associated with this Payment Link will automatically be copied to [checkout sessions](https://docs.stripe.com/api/checkout/sessions) created by this payment link.

### **More parameters**

### Expand all

* #### **after\_completion**object

* #### **allow\_promotion\_codes**boolean

* #### **application\_fee\_amount**integerConnect only

* #### **application\_fee\_percent**floatConnect only

* #### **automatic\_tax**object

* #### **billing\_address\_collection**enum

* #### **consent\_collection**object

* #### **currency**enum

* #### **custom\_fields**array of objects

* #### **custom\_text**object

* #### **customer\_creation**enum

* #### **inactive\_message**string

* #### **invoice\_creation**object

* #### **on\_behalf\_of**stringConnect only

* #### **optional\_items**array of objects

* #### **payment\_intent\_data**object

* #### **payment\_method\_collection**enum

* #### **payment\_method\_types**array of enums

* #### **phone\_number\_collection**object

* #### **restrictions**object

* #### **shipping\_address\_collection**object

* #### **shipping\_options**array of objects

* #### **submit\_type**enum

* #### **subscription\_data**object

* #### **tax\_id\_collection**object

* #### **transfer\_data**objectConnect only

### **Returns**

Returns the payment link.  
POST /v1/payment\_links  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/payment\_links \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "line\_items\[0\]\[price\]"\=price\_1MoC3TLkdIwHu7ixcIbKelAC \\  
 \-d "line\_items\[0\]\[quantity\]"\=1  
Response  
{  
 "id": "plink\_1MoC3ULkdIwHu7ixZjtGpVl2",  
 "object": "payment\_link",  
 "active": true,  
 "after\_completion": {  
   "hosted\_confirmation": {  
     "custom\_message": null  
   },  
   "type": "hosted\_confirmation"  
 },  
 "allow\_promotion\_codes": false,  
 "application\_fee\_amount": null,  
 "application\_fee\_percent": null,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null  
 },  
 "billing\_address\_collection": "auto",  
 "consent\_collection": null,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer\_creation": "if\_required",  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "metadata": {},  
 "on\_behalf\_of": null,  
 "payment\_intent\_data": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_types": null,  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "shipping\_address\_collection": null,  
 "shipping\_options": \[\],  
 "submit\_type": "auto",  
 "subscription\_data": {  
   "description": null,  
   "invoice\_settings": {  
     "issuer": {  
       "type": "self"  
     }  
   },  
   "trial\_period\_days": null  
 },  
 "tax\_id\_collection": {  
   "enabled": false  
 },  
 "transfer\_data": null,  
 "url": "https://buy.stripe.com/test\_cN25nr0iZ7bUa7meUY"  
}

# [**Update a payment link**](https://docs.stripe.com/api/payment-link/update) 

Updates a payment link.

### **Parameters**

* #### **active**boolean

* Whether the payment link’s url is active. If false, customers visiting the URL will be shown a page saying that the link has been deactivated.

* #### **line\_items**array of objects

* The line items representing what is being sold. Each line item represents an item being sold. Up to 20 line items are supported.  
* Show child parameters

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata. Metadata associated with this Payment Link will automatically be copied to [checkout sessions](https://docs.stripe.com/api/checkout/sessions) created by this payment link.

### **More parameters**

### Expand all

* #### **after\_completion**object

* #### **allow\_promotion\_codes**boolean

* #### **automatic\_tax**object

* #### **billing\_address\_collection**enum

* #### **custom\_fields**array of objects

* #### **custom\_text**object

* #### **customer\_creation**enum

* #### **inactive\_message**string

* #### **invoice\_creation**object

* #### **payment\_intent\_data**object

* #### **payment\_method\_collection**enum

* #### **payment\_method\_types**array of enums

* #### **phone\_number\_collection**object

* #### **restrictions**object

* #### **shipping\_address\_collection**object

* #### **submit\_type**enum

* #### **subscription\_data**object

* #### **tax\_id\_collection**object

### **Returns**

Updated payment link.  
POST /v1/payment\_links/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/payment\_links/plink\_1MoC3ULkdIwHu7ixZjtGpVl2 \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "metadata\[order\_id\]"\=6735  
Response  
{  
 "id": "plink\_1MoC3ULkdIwHu7ixZjtGpVl2",  
 "object": "payment\_link",  
 "active": true,  
 "after\_completion": {  
   "hosted\_confirmation": {  
     "custom\_message": null  
   },  
   "type": "hosted\_confirmation"  
 },  
 "allow\_promotion\_codes": false,  
 "application\_fee\_amount": null,  
 "application\_fee\_percent": null,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null  
 },  
 "billing\_address\_collection": "auto",  
 "consent\_collection": null,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer\_creation": "if\_required",  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "metadata": {  
   "order\_id": "6735"  
 },  
 "on\_behalf\_of": null,  
 "payment\_intent\_data": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_types": null,  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "shipping\_address\_collection": null,  
 "shipping\_options": \[\],  
 "submit\_type": "auto",  
 "subscription\_data": {  
   "description": null,  
   "invoice\_settings": {  
     "issuer": {  
       "type": "self"  
     }  
   },  
   "trial\_period\_days": null  
 },  
 "tax\_id\_collection": {  
   "enabled": false  
 },  
 "transfer\_data": null,  
 "url": "https://buy.stripe.com/test\_cN25nr0iZ7bUa7meUY"  
}

# [**Retrieve a payment link's line items**](https://docs.stripe.com/api/payment-link/retrieve-line-items) 

When retrieving a payment link, there is an includable **line\_items** property containing the first handful of those items. There is also a URL where you can retrieve the full (paginated) list of line items.

### **Parameters**

No parameters.

### **More parameters**

### Expand all

* #### **ending\_before**string

* #### **limit**integer

* #### **starting\_after**string

### **Returns**

A dictionary with a data property that contains an array of up to limit payment link line items, starting after Line Item starting\_after. Each entry in the array is a separate Line Item object. If no more line items are available, the resulting array will be empty.  
GET /v1/payment\_links/:id/line\_items  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/payment\_links/plink\_1N4CWjLkdIwHu7ix2Y2F1kqb/line\_items \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "object": "list",  
 "data": \[  
   {  
     "id": "li\_NpsHNiHSaDeU0X",  
     "object": "item",  
     "amount\_discount": 0,  
     "amount\_subtotal": 1099,  
     "amount\_tax": 0,  
     "amount\_total": 1099,  
     "currency": "usd",  
     "description": "T-shirt",  
     "price": {  
       "id": "price\_1N4AEsLkdIwHu7ix7Ssho8Cl",  
       "object": "price",  
       "active": true,  
       "billing\_scheme": "per\_unit",  
       "created": 1683237782,  
       "currency": "usd",  
       "custom\_unit\_amount": null,  
       "livemode": false,  
       "lookup\_key": null,  
       "metadata": {},  
       "nickname": null,  
       "product": "prod\_NppuJWzzNnD5Ut",  
       "recurring": null,  
       "tax\_behavior": "unspecified",  
       "tiers\_mode": null,  
       "transform\_quantity": null,  
       "type": "one\_time",  
       "unit\_amount": 1099,  
       "unit\_amount\_decimal": "1099"  
     },  
     "quantity": 1  
   }  
 \],  
 "has\_more": false,  
 "url": "/v1/payment\_links/plink\_1N4CWjLkdIwHu7ix2Y2F1kqb/line\_items"  
}

# [**Retrieve payment link**](https://docs.stripe.com/api/payment-link/retrieve) 

Retrieve a payment link.

### **Parameters**

No parameters.

### **Returns**

Returns the payment link.  
GET /v1/payment\_links/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/payment\_links/plink\_1MoC3ULkdIwHu7ixZjtGpVl2 \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "plink\_1MoC3ULkdIwHu7ixZjtGpVl2",  
 "object": "payment\_link",  
 "active": true,  
 "after\_completion": {  
   "hosted\_confirmation": {  
     "custom\_message": null  
   },  
   "type": "hosted\_confirmation"  
 },  
 "allow\_promotion\_codes": false,  
 "application\_fee\_amount": null,  
 "application\_fee\_percent": null,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null  
 },  
 "billing\_address\_collection": "auto",  
 "consent\_collection": null,  
 "currency": "usd",  
 "custom\_fields": \[\],  
 "custom\_text": {  
   "shipping\_address": null,  
   "submit": null  
 },  
 "customer\_creation": "if\_required",  
 "invoice\_creation": {  
   "enabled": false,  
   "invoice\_data": {  
     "account\_tax\_ids": null,  
     "custom\_fields": null,  
     "description": null,  
     "footer": null,  
     "issuer": null,  
     "metadata": {},  
     "rendering\_options": null  
   }  
 },  
 "livemode": false,  
 "metadata": {},  
 "on\_behalf\_of": null,  
 "payment\_intent\_data": null,  
 "payment\_method\_collection": "always",  
 "payment\_method\_types": null,  
 "phone\_number\_collection": {  
   "enabled": false  
 },  
 "shipping\_address\_collection": null,  
 "shipping\_options": \[\],  
 "submit\_type": "auto",  
 "subscription\_data": {  
   "description": null,  
   "invoice\_settings": {  
     "issuer": {  
       "type": "self"  
     }  
   },  
   "trial\_period\_days": null  
 },  
 "tax\_id\_collection": {  
   "enabled": false  
 },  
 "transfer\_data": null,  
 "url": "https://buy.stripe.com/test\_cN25nr0iZ7bUa7meUY"  
}

# [**List all payment links**](https://docs.stripe.com/api/payment-link/list) 

Returns a list of your payment links.

### **Parameters**

* #### **active**boolean

* Only return payment links that are active or inactive (e.g., pass false to list all inactive payment links).

### **More parameters**

### Expand all

* #### **ending\_before**string

* #### **limit**integer

* #### **starting\_after**string

### **Returns**

A dictionary with a data property that contains an array of up to limit payment links, starting after payment link starting\_after. Each entry in the array is a separate payment link object. If no more payment links are available, the resulting array will be empty. This request should never raise an error.  
GET /v1/payment\_links  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-G https://api.stripe.com/v1/payment\_links \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d limit=3  
Response  
{  
 "object": "list",  
 "url": "/v1/payment\_links",  
 "has\_more": false,  
 "data": \[  
   {  
     "id": "plink\_1MoC3ULkdIwHu7ixZjtGpVl2",  
     "object": "payment\_link",  
     "active": true,  
     "after\_completion": {  
       "hosted\_confirmation": {  
         "custom\_message": null  
       },  
       "type": "hosted\_confirmation"  
     },  
     "allow\_promotion\_codes": false,  
     "application\_fee\_amount": null,  
     "application\_fee\_percent": null,  
     "automatic\_tax": {  
       "enabled": false,  
       "liability": null  
     },  
     "billing\_address\_collection": "auto",  
     "consent\_collection": null,  
     "currency": "usd",  
     "custom\_fields": \[\],  
     "custom\_text": {  
       "shipping\_address": null,  
       "submit": null  
     },  
     "customer\_creation": "if\_required",  
     "invoice\_creation": {  
       "enabled": false,  
       "invoice\_data": {  
         "account\_tax\_ids": null,  
         "custom\_fields": null,  
         "description": null,  
         "footer": null,  
         "issuer": null,  
         "metadata": {},  
         "rendering\_options": null  
       }  
     },  
     "livemode": false,  
     "metadata": {},  
     "on\_behalf\_of": null,  
     "payment\_intent\_data": null,  
     "payment\_method\_collection": "always",  
     "payment\_method\_types": null,  
     "phone\_number\_collection": {  
       "enabled": false  
     },  
     "shipping\_address\_collection": null,  
     "shipping\_options": \[\],  
     "submit\_type": "auto",  
     "subscription\_data": {  
       "description": null,  
       "invoice\_settings": {  
         "issuer": {  
           "type": "self"  
         }  
       },  
       "trial\_period\_days": null  
     },  
     "tax\_id\_collection": {  
       "enabled": false  
     },  
     "transfer\_data": null,  
     "url": "https://buy.stripe.com/test\_cN25nr0iZ7bUa7meUY"  
   }  
 \]  
}

# [**Invoices**](https://docs.stripe.com/api/invoices) 

Invoices are statements of amounts owed by a customer, and are either generated one-off, or generated periodically from a subscription.  
They contain [invoice items](https://docs.stripe.com/api/payment-link/update#invoiceitems), and proration adjustments that may be caused by subscription upgrades/downgrades (if necessary).  
If your invoice is configured to be billed through automatic charges, Stripe automatically finalizes your invoice and attempts payment. Note that finalizing the invoice, [when automatic](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection), does not happen immediately as the invoice is created. Stripe waits until one hour after the last webhook was successfully sent (or the last webhook timed out after failing). If you (and the platforms you may have connected to) have no webhooks configured, Stripe waits one hour after creation to finalize the invoice.  
If your invoice is configured to be billed by sending an email, then based on your [email settings](https://dashboard.stripe.com/account/billing/automatic), Stripe will email the invoice to your customer and await payment. These emails can contain a link to a hosted page to pay the invoice.  
Stripe applies any customer credit on the account before determining the amount due for the invoice (i.e., the amount that will be actually charged). If the amount due for the invoice is less than Stripe’s [minimum allowed charge per currency](https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts), the invoice is automatically marked paid, and we add the amount due to the customer’s credit balance which is applied to the next invoice.  
More details on the customer’s credit balance are [here](https://docs.stripe.com/billing/customer/balance).  
Related guide: [Send invoices to customers](https://docs.stripe.com/billing/invoices/sending)

Was this section helpful?YesNo  
Endpoints  
[POST/v1/invoices](https://docs.stripe.com/api/invoices/create)[POST/v1/invoices/create\_preview](https://docs.stripe.com/api/invoices/create_preview)[POST/v1/invoices/:id](https://docs.stripe.com/api/invoices/update)[GET/v1/invoices/:id](https://docs.stripe.com/api/invoices/retrieve)[GET/v1/invoices](https://docs.stripe.com/api/invoices/list)[DELETE/v1/invoices/:id](https://docs.stripe.com/api/invoices/delete)[POST/v1/invoices/:id/finalize](https://docs.stripe.com/api/invoices/finalize)[POST/v1/invoices/:id/mark\_uncollectible](https://docs.stripe.com/api/invoices/mark_uncollectible)[POST/v1/invoices/:id/pay](https://docs.stripe.com/api/invoices/pay)[GET/v1/invoices/search](https://docs.stripe.com/api/invoices/search)[POST/v1/invoices/:id/send](https://docs.stripe.com/api/invoices/send)[POST/v1/invoices/:id/void](https://docs.stripe.com/api/invoices/void)

# [**The Invoice object**](https://docs.stripe.com/api/invoices/object) 

### **Attributes**

* #### **id**string

* Unique identifier for the object. This property is always present unless the invoice is an upcoming invoice. See [Retrieve an upcoming invoice](https://stripe.com/docs/api/invoices/upcoming) for more details.

* #### **auto\_advance**boolean

* Controls whether Stripe performs [automatic collection](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection) of the invoice. If false, the invoice’s state doesn’t automatically advance without an explicit action.

* #### **automatic\_tax**object

* Settings and latest results for automatic tax lookup for this invoice.  
* Show child attributes

* #### **collection\_method**enum

* Either charge\_automatically, or send\_invoice. When charging automatically, Stripe will attempt to pay this invoice using the default source attached to the customer. When sending an invoice, Stripe will email this invoice to the customer with payment instructions.  
* Possible enum values

| charge\_automatically Attempt payment using the default source attached to the customer. |
| :---- |
| send\_invoice Email payment instructions to the customer. |

* #### **confirmation\_secret**nullable objectExpandable

* The confirmation secret associated with this invoice. Currently, this contains the client\_secret of the PaymentIntent that Stripe creates during invoice finalization.  
* Show child attributes

* #### **currency**enum

* Three-letter [ISO currency code](https://www.iso.org/iso-4217-currency-codes.html), in lowercase. Must be a [supported currency](https://stripe.com/docs/currencies).

* #### **customer**stringExpandable

* The ID of the customer who will be billed.

* #### **description**nullable string

* An arbitrary string attached to the object. Often useful for displaying to users. Referenced as ‘memo’ in the Dashboard.

* #### **hosted\_invoice\_url**nullable string

* The URL for the hosted invoice page, which allows customers to view and pay an invoice. If the invoice has not been finalized yet, this will be null.

* #### **lines**object

* The individual line items that make up the invoice. lines is sorted as follows: (1) pending invoice items (including prorations) in reverse chronological order, (2) subscription items in reverse chronological order, and (3) invoice items added after invoice creation in chronological order.  
* Show child attributes

* #### **metadata**nullable object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format.

* #### **parent**nullable object

* The parent that generated this invoice  
* Show child attributes

* #### **period\_end**timestamp

* End of the usage period during which invoice items were added to this invoice. This looks back one period for a subscription invoice. Use the [line item period](https://docs.stripe.com/api/invoices/line_item#invoice_line_item_object-period) to get the service period for each price.

* #### **period\_start**timestamp

* Start of the usage period during which invoice items were added to this invoice. This looks back one period for a subscription invoice. Use the [line item period](https://docs.stripe.com/api/invoices/line_item#invoice_line_item_object-period) to get the service period for each price.

* #### **status**nullable enum

* The status of the invoice, one of draft, open, paid, uncollectible, or void. [Learn more](https://docs.stripe.com/billing/invoices/workflow#workflow-overview)

* #### **total**integer

* Total after discounts and taxes.

### **More attributes**

### Expand all

* #### **object**string

* #### **account\_country**nullable string

* #### **account\_name**nullable string

* #### **account\_tax\_ids**nullable array of stringsExpandable

* #### **amount\_due**integer

* #### **amount\_overpaid**integer

* #### **amount\_paid**integer

* #### **amount\_remaining**integer

* #### **amount\_shipping**integer

* #### **application**nullable stringExpandableConnect only

* #### **attempt\_count**integer

* #### **attempted**boolean

* #### **automatically\_finalizes\_at**nullable timestamp

* #### **billing\_reason**nullable enum

* #### **created**timestamp

* #### **custom\_fields**nullable array of objects

* #### **customer\_address**nullable object

* #### **customer\_email**nullable string

* #### **customer\_name**nullable string

* #### **customer\_phone**nullable string

* #### **customer\_shipping**nullable object

* #### **customer\_tax\_exempt**nullable enum

* #### **customer\_tax\_ids**nullable array of objects

* #### **default\_payment\_method**nullable stringExpandable

* #### **default\_source**nullable stringExpandable

* #### **default\_tax\_rates**array of objects

* #### **discounts**array of stringsExpandable

* #### **due\_date**nullable timestamp

* #### **effective\_at**nullable timestamp

* #### **ending\_balance**nullable integer

* #### **footer**nullable string

* #### **from\_invoice**nullable object

* #### **invoice\_pdf**nullable string

* #### **issuer**objectConnect only

* #### **last\_finalization\_error**nullable object

* #### **latest\_revision**nullable stringExpandable

* #### **livemode**boolean

* #### **next\_payment\_attempt**nullable timestamp

* #### **number**nullable string

* #### **on\_behalf\_of**nullable stringExpandableConnect only

* #### **payment\_settings**object

* #### **payments**objectExpandable

* #### **post\_payment\_credit\_notes\_amount**integer

* #### **pre\_payment\_credit\_notes\_amount**integer

* #### **receipt\_number**nullable string

* #### **rendering**nullable object

* #### **shipping\_cost**nullable object

* #### **shipping\_details**nullable object

* #### **starting\_balance**integer

* #### **statement\_descriptor**nullable string

* #### **status\_transitions**object

* #### **subtotal**integer

* #### **subtotal\_excluding\_tax**nullable integer

* #### **test\_clock**nullable stringExpandable

* #### **threshold\_reason**nullable object

* #### **total\_discount\_amounts**nullable array of objects

* #### **total\_excluding\_tax**nullable integer

* #### **total\_pretax\_credit\_amounts**nullable array of objects

* #### **total\_taxes**nullable array of objects

* #### **webhooks\_delivered\_at**nullable timestamp

The Invoice object  
{  
 "id": "in\_1MtHbELkdIwHu7ixl4OzzPMv",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1680644467,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZwdNtLEOXuvB",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "confirmation\_secret": null,  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv/lines"  
 },  
 "payments": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoice\_payments"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680644467,  
 "period\_start": 1680644467,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "transfer\_data": null,  
 "webhooks\_delivered\_at": 1680644467  
}

# [**Create an invoice**](https://docs.stripe.com/api/invoices/create) 

This endpoint creates a draft invoice for a given customer. The invoice remains a draft until you [finalize](https://docs.stripe.com/api/payment-link/update#finalize_invoice) the invoice, which allows you to [pay](https://docs.stripe.com/api/payment-link/update#pay_invoice) or [send](https://docs.stripe.com/api/payment-link/update#send_invoice) the invoice to your customers.

### **Parameters**

* #### **auto\_advance**boolean

* Controls whether Stripe performs [automatic collection](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection) of the invoice. If false, the invoice’s state doesn’t automatically advance without an explicit action.

* #### **automatic\_tax**object

* Settings for automatic tax lookup for this invoice.  
* Show child parameters

* #### **collection\_method**enum

* Either charge\_automatically, or send\_invoice. When charging automatically, Stripe will attempt to pay this invoice using the default source attached to the customer. When sending an invoice, Stripe will email this invoice to the customer with payment instructions. Defaults to charge\_automatically.  
* Possible enum values

| charge\_automatically |
| :---- |
| send\_invoice |

* #### **customer**stringRequired unless from\_invoice is provided

* The ID of the customer who will be billed.

* #### **description**string

* An arbitrary string attached to the object. Often useful for displaying to users. Referenced as ‘memo’ in the Dashboard.

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

* #### **subscription**string

* The ID of the subscription to invoice, if any. If set, the created invoice will only include pending invoice items for that subscription. The subscription’s billing cycle and regular subscription events won’t be affected.

### **More parameters**

### Expand all

* #### **account\_tax\_ids**array of strings

* #### **application\_fee\_amount**integerConnect only

* #### **automatically\_finalizes\_at**timestamp

* #### **currency**enum

* #### **custom\_fields**array of objects

* #### **days\_until\_due**integer

* #### **default\_payment\_method**string

* #### **default\_source**string

* #### **default\_tax\_rates**array of strings

* #### **discounts**array of objects

* #### **due\_date**timestamp

* #### **effective\_at**timestamp

* #### **footer**string

* #### **from\_invoice**objectRequired unless customer is provided

* #### **issuer**objectConnect only

* #### **number**string

* #### **on\_behalf\_of**stringConnect only

* #### **payment\_settings**object

* #### **pending\_invoice\_items\_behavior**enum

* #### **rendering**object

* #### **shipping\_cost**object

* #### **shipping\_details**object

* #### **statement\_descriptor**string

* #### **transfer\_data**objectConnect only

### **Returns**

Returns the invoice object. Raises [an error](https://docs.stripe.com/api/payment-link/update#errors) if the customer ID provided is invalid.  
POST /v1/invoices  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d customer=cus\_NeZwdNtLEOXuvB  
Response  
{  
 "id": "in\_1MtHbELkdIwHu7ixl4OzzPMv",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1680644467,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZwdNtLEOXuvB",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680644467,  
 "period\_start": 1680644467,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680644467  
}

# [**Create a preview invoice**](https://docs.stripe.com/api/invoices/create_preview) 

At any time, you can preview the upcoming invoice for a subscription or subscription schedule. This will show you all the charges that are pending, including subscription renewal charges, invoice item charges, etc. It will also show you any discounts that are applicable to the invoice.  
Note that when you are viewing an upcoming invoice, you are simply viewing a preview – the invoice has not yet been created. As such, the upcoming invoice will not show up in invoice listing calls, and you cannot use the API to pay or edit the invoice. If you want to change the amount that your customer will be billed, you can add, remove, or update pending invoice items, or update the customer’s discount.  
You can preview the effects of updating a subscription, including a preview of what proration will take place. To ensure that the actual proration is calculated exactly the same as the previewed proration, you should pass the subscription\_details.proration\_date parameter when doing the actual subscription update. The recommended way to get only the prorations being previewed is to consider only proration line items where period\[start\] is equal to the subscription\_details.proration\_date value passed in the request.  
Note: Currency conversion calculations use the latest exchange rates. Exchange rates may vary between the time of the preview and the time of the actual invoice creation. [Learn more](https://docs.stripe.com/currencies/conversions)

### **Parameters**

* #### **automatic\_tax**object

* Settings for automatic tax lookup for this invoice preview.  
* Show child parameters

* #### **customer**string

* The identifier of the customer whose upcoming invoice you’d like to retrieve. If automatic\_tax is enabled then one of customer, customer\_details, subscription, or schedule must be set.

* #### **subscription**string

* The identifier of the subscription for which you’d like to retrieve the upcoming invoice. If not provided, but a subscription\_details.items is provided, you will preview creating a subscription with those items. If neither subscription nor subscription\_details.items is provided, you will retrieve the next upcoming invoice from among the customer’s subscriptions.

### **More parameters**

### Expand all

* #### **currency**enum

* #### **customer\_details**object

* #### **discounts**array of objects

* #### **invoice\_items**array of objects

* #### **issuer**objectConnect only

* #### **on\_behalf\_of**stringConnect only

* #### **preview\_mode**enum

* #### **schedule**string

* #### **schedule\_details**object

* #### **subscription\_details**object

### **Returns**

Returns an invoice if valid customer information is provided. Raises [an error](https://docs.stripe.com/api/payment-link/update#errors) otherwise.  
POST /v1/invoices/create\_preview  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices/create\_preview \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d customer=cus\_NeZwdNtLEOXuvB  
Response  
{  
 "id": "upcoming\_in\_1MtHbELkdIwHu7ixl4OzzPMv",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "application\_fee\_amount": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1680644467,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZwdNtLEOXuvB",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680644467,  
 "period\_start": 1680644467,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680644467  
}

# [**Update an invoice**](https://docs.stripe.com/api/invoices/update) 

Draft invoices are fully editable. Once an invoice is [finalized](https://docs.stripe.com/billing/invoices/workflow#finalized), monetary values, as well as collection\_method, become uneditable.  
If you would like to stop the Stripe Billing engine from automatically finalizing, reattempting payments on, sending reminders for, or [automatically reconciling](https://docs.stripe.com/billing/invoices/reconciliation) invoices, pass auto\_advance=false.

### **Parameters**

* #### **auto\_advance**boolean

* Controls whether Stripe performs [automatic collection](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection) of the invoice.

* #### **automatic\_tax**object

* Settings for automatic tax lookup for this invoice.  
* Show child parameters

* #### **collection\_method**enum

* Either charge\_automatically or send\_invoice. This field can be updated only on draft invoices.  
* Possible enum values

| charge\_automatically |
| :---- |
| send\_invoice |

* #### **description**string

* An arbitrary string attached to the object. Often useful for displaying to users. Referenced as ‘memo’ in the Dashboard.

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

### **More parameters**

### Expand all

* #### **account\_tax\_ids**array of strings

* #### **application\_fee\_amount**integerConnect only

* #### **automatically\_finalizes\_at**timestamp

* #### **custom\_fields**array of objects

* #### **days\_until\_due**integer

* #### **default\_payment\_method**string

* #### **default\_source**string

* #### **default\_tax\_rates**array of strings

* #### **discounts**array of objects

* #### **due\_date**timestamp

* #### **effective\_at**timestamp

* #### **footer**string

* #### **issuer**objectConnect only

* #### **number**string

* #### **on\_behalf\_of**stringConnect only

* #### **payment\_settings**object

* #### **rendering**object

* #### **shipping\_cost**object

* #### **shipping\_details**object

* #### **statement\_descriptor**string

* #### **transfer\_data**objectConnect only

### **Returns**

Returns the invoice object.  
POST /v1/invoices/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "metadata\[order\_id\]"\=6735  
Response  
{  
 "id": "in\_1MtHbELkdIwHu7ixl4OzzPMv",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1680644467,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZwdNtLEOXuvB",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv/lines"  
 },  
 "livemode": false,  
 "metadata": {  
   "order\_id": "6735"  
 },  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680644467,  
 "period\_start": 1680644467,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680644467  
}

# [**Retrieve an invoice**](https://docs.stripe.com/api/invoices/retrieve) 

Retrieves the invoice with the given ID.

### **Parameters**

No parameters.

### **Returns**

Returns an invoice object if a valid invoice ID was provided. Raises [an error](https://docs.stripe.com/api/payment-link/update#errors) otherwise.  
The invoice object contains a lines hash that contains information about the subscriptions and invoice items that have been applied to the invoice, as well as any prorations that Stripe has automatically calculated. Each line on the invoice has an amount attribute that represents the amount actually contributed to the invoice’s total. For invoice items and prorations, the amount attribute is the same as for the invoice item or proration respectively. For subscriptions, the amount may be different from the plan’s regular price depending on whether the invoice covers a trial period or the invoice period differs from the plan’s usual interval.  
The invoice object has both a subtotal and a total. The subtotal represents the total before any discounts, while the total is the final amount to be charged to the customer after all coupons have been applied.  
The invoice also has a next\_payment\_attempt attribute that tells you the next time (as a Unix timestamp) payment for the invoice will be automatically attempted. For invoices with manual payment collection, that have been closed, or that have reached the maximum number of retries (specified in your [subscriptions settings](https://dashboard.stripe.com/account/billing/automatic)), the next\_payment\_attempt will be null.  
GET /v1/invoices/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "in\_1MtHbELkdIwHu7ixl4OzzPMv",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1680644467,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZwdNtLEOXuvB",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680644467,  
 "period\_start": 1680644467,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680644467  
}

# [**List all invoices**](https://docs.stripe.com/api/invoices/list) 

You can list all invoices, or list the invoices for a specific customer. The invoices are returned sorted by creation date, with the most recently created invoices appearing first.

### **Parameters**

* #### **customer**string

* Only return invoices for the customer specified by this customer ID.

* #### **status**enum

* The status of the invoice, one of draft, open, paid, uncollectible, or void. [Learn more](https://docs.stripe.com/billing/invoices/workflow#workflow-overview)

* #### **subscription**string

* Only return invoices for the subscription specified by this subscription ID.

### **More parameters**

### Expand all

* #### **collection\_method**enum

* #### **created**object

* #### **ending\_before**string

* #### **limit**integer

* #### **starting\_after**string

### **Returns**

A dictionary with a data property that contains an array invoice attachments,  
GET /v1/invoices  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-G https://api.stripe.com/v1/invoices \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d limit=3  
Response  
{  
 "object": "list",  
 "url": "/v1/invoices",  
 "has\_more": false,  
 "data": \[  
   {  
     "id": "in\_1MtHbELkdIwHu7ixl4OzzPMv",  
     "object": "invoice",  
     "account\_country": "US",  
     "account\_name": "Stripe Docs",  
     "account\_tax\_ids": null,  
     "amount\_due": 0,  
     "amount\_paid": 0,  
     "amount\_overpaid": 0,  
     "amount\_remaining": 0,  
     "amount\_shipping": 0,  
     "application": null,  
     "attempt\_count": 0,  
     "attempted": false,  
     "auto\_advance": false,  
     "automatic\_tax": {  
       "enabled": false,  
       "liability": null,  
       "status": null  
     },  
     "billing\_reason": "manual",  
     "collection\_method": "charge\_automatically",  
     "created": 1680644467,  
     "currency": "usd",  
     "custom\_fields": null,  
     "customer": "cus\_NeZwdNtLEOXuvB",  
     "customer\_address": null,  
     "customer\_email": "jennyrosen@example.com",  
     "customer\_name": "Jenny Rosen",  
     "customer\_phone": null,  
     "customer\_shipping": null,  
     "customer\_tax\_exempt": "none",  
     "customer\_tax\_ids": \[\],  
     "default\_payment\_method": null,  
     "default\_source": null,  
     "default\_tax\_rates": \[\],  
     "description": null,  
     "discounts": \[\],  
     "due\_date": null,  
     "ending\_balance": null,  
     "footer": null,  
     "from\_invoice": null,  
     "hosted\_invoice\_url": null,  
     "invoice\_pdf": null,  
     "issuer": {  
       "type": "self"  
     },  
     "last\_finalization\_error": null,  
     "latest\_revision": null,  
     "lines": {  
       "object": "list",  
       "data": \[\],  
       "has\_more": false,  
       "total\_count": 0,  
       "url": "/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv/lines"  
     },  
     "livemode": false,  
     "metadata": {},  
     "next\_payment\_attempt": null,  
     "number": null,  
     "on\_behalf\_of": null,  
     "parent": null,  
     "payment\_settings": {  
       "default\_mandate": null,  
       "payment\_method\_options": null,  
       "payment\_method\_types": null  
     },  
     "period\_end": 1680644467,  
     "period\_start": 1680644467,  
     "post\_payment\_credit\_notes\_amount": 0,  
     "pre\_payment\_credit\_notes\_amount": 0,  
     "receipt\_number": null,  
     "shipping\_cost": null,  
     "shipping\_details": null,  
     "starting\_balance": 0,  
     "statement\_descriptor": null,  
     "status": "draft",  
     "status\_transitions": {  
       "finalized\_at": null,  
       "marked\_uncollectible\_at": null,  
       "paid\_at": null,  
       "voided\_at": null  
     },  
     "subtotal": 0,  
     "subtotal\_excluding\_tax": 0,  
     "test\_clock": null,  
     "total": 0,  
     "total\_discount\_amounts": \[\],  
     "total\_excluding\_tax": 0,  
     "total\_taxes": \[\],  
     "webhooks\_delivered\_at": 1680644467  
   }  
 \]  
}

# [**Delete a draft invoice**](https://docs.stripe.com/api/invoices/delete) 

Permanently deletes a one-off invoice draft. This cannot be undone. Attempts to delete invoices that are no longer in a draft state will fail; once an invoice has been finalized or if an invoice is for a subscription, it must be [voided](https://docs.stripe.com/api/payment-link/update#void_invoice).

### **Parameters**

No parameters.

### **Returns**

A successfully deleted invoice. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors), such as if the invoice has already been deleted.  
DELETE /v1/invoices/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X DELETE https://api.stripe.com/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "in\_1MtHbELkdIwHu7ixl4OzzPMv",  
 "object": "invoice",  
 "deleted": true  
}

# [**Finalize an invoice**](https://docs.stripe.com/api/invoices/finalize) 

Stripe automatically finalizes drafts before sending and attempting payment on invoices. However, if you’d like to finalize a draft invoice manually, you can do so using this method.

### **Parameters**

* #### **auto\_advance**boolean

* Controls whether Stripe performs [automatic collection](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection) of the invoice. If false, the invoice’s state doesn’t automatically advance without an explicit action.

### **Returns**

Returns an invoice object with status=open.  
POST /v1/invoices/:id/finalize  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X POST https://api.stripe.com/v1/invoices/in\_1MtGmCLkdIwHu7ix6PgS6g8S/finalize \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "in\_1MtGmCLkdIwHu7ix6PgS6g8S",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": true,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "send\_invoice",  
 "created": 1680641304,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZw0zvTyquTfF",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": 1681246104,  
 "ending\_balance": 0,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": "https://invoice.stripe.com/i/acct\_1M2JTkLkdIwHu7ix/test\_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm?s=ap",  
 "invoice\_pdf": "https://pay.stripe.com/invoice/acct\_1M2JTkLkdIwHu7ix/test\_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm/pdf?s=ap",  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtGmCLkdIwHu7ix6PgS6g8S/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": "9545A614-0001",  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680641304,  
 "period\_start": 1680641304,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "paid",  
 "status\_transitions": {  
   "finalized\_at": 1680641304,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": 1680641304,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680641304  
}

# [**Mark an invoice as uncollectible**](https://docs.stripe.com/api/invoices/mark_uncollectible) 

Marking an invoice as uncollectible is useful for keeping track of bad debts that can be written off for accounting purposes.

### **Parameters**

No parameters.

### **Returns**

Returns the invoice object.  
POST /v1/invoices/:id/mark\_uncollectible  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X POST https://api.stripe.com/v1/invoices/in\_1MtG0nLkdIwHu7ixAaUw3Cb4/mark\_uncollectible \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "in\_1MtG0nLkdIwHu7ixAaUw3Cb4",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 599,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 599,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1680638365,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZw0zvTyquTfF",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[  
   {  
     "type": "eu\_vat",  
     "value": "DE123456789"  
   },  
   {  
     "type": "eu\_vat",  
     "value": "DE123456781"  
   }  
 \],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[  
     {  
       "id": "il\_1MtG0nLkdIwHu7ix3eCoIIw7",  
       "object": "line\_item",  
       "amount": 1099,  
       "currency": "usd",  
       "description": "My First Invoice Item (created for API docs)",  
       "discount\_amounts": \[\],  
       "discountable": true,  
       "discounts": \[\],  
       "livemode": false,  
       "metadata": {},  
       "parent": {  
         "type": "invoice\_item\_details",  
         "invoice\_item\_details": {  
           "invoice\_item": "ii\_1MtG0nLkdIwHu7ixDqfiUgg8",  
           "proration": false,  
           "proration\_details": {  
             "credited\_items": null  
           },  
           "subscription": null  
         }  
       },  
       "period": {  
         "end": 1680638365,  
         "start": 1680638365  
       },  
       "pricing": {  
         "price\_details": {  
           "price": "price\_1Mr89PLkdIwHu7ixf5QhiWm2",  
           "product": "prod\_NcMtLgctyqlJDC"  
         },  
         "type": "price\_details",  
         "unit\_amount\_decimal": "1099"  
       },  
       "quantity": 1,  
       "taxes": \[\]  
     }  
   \],  
   "has\_more": false,  
   "url": "/v1/invoices/in\_1MtG0nLkdIwHu7ixAaUw3Cb4/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680638365,  
 "period\_start": 1680638365,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": \-500,  
 "statement\_descriptor": null,  
 "status": "uncollectible",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 1099,  
 "subtotal\_excluding\_tax": 1099,  
 "test\_clock": null,  
 "total": 1099,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 1099,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": null,  
 "closed": true,  
 "forgiven": true  
}

# [**Pay an invoice**](https://docs.stripe.com/api/invoices/pay) 

Stripe automatically creates and then attempts to collect payment on invoices for customers on subscriptions according to your [subscriptions settings](https://dashboard.stripe.com/account/billing/automatic). However, if you’d like to attempt payment on an invoice out of the normal collection schedule or for some other reason, you can do so.

### **Parameters**

No parameters.

### **More parameters**

### Expand all

* #### **forgive**boolean

* #### **mandate**string

* #### **off\_session**boolean

* #### **paid\_out\_of\_band**boolean

* #### **payment\_method**string

* #### **source**string

### **Returns**

Returns the invoice object.  
POST /v1/invoices/:id/pay  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X POST https://api.stripe.com/v1/invoices/in\_1MtGmCLkdIwHu7ix6PgS6g8S/pay \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "in\_1MtGmCLkdIwHu7ix6PgS6g8S",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": true,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "send\_invoice",  
 "created": 1680641304,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZw0zvTyquTfF",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": 1681246104,  
 "ending\_balance": 0,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": "https://invoice.stripe.com/i/acct\_1M2JTkLkdIwHu7ix/test\_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm?s=ap",  
 "invoice\_pdf": "https://pay.stripe.com/invoice/acct\_1M2JTkLkdIwHu7ix/test\_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm/pdf?s=ap",  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtGmCLkdIwHu7ix6PgS6g8S/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": "9545A614-0001",  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680641304,  
 "period\_start": 1680641304,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "paid",  
 "status\_transitions": {  
   "finalized\_at": 1680641304,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": 1680641304,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680641304  
}

# [**Search invoices**](https://docs.stripe.com/api/invoices/search) 

Search for invoices you’ve previously created using Stripe’s [Search Query Language](https://docs.stripe.com/search#search-query-language). Don’t use search in read-after-write flows where strict consistency is necessary. Under normal operating conditions, data is searchable in less than a minute. Occasionally, propagation of new or updated data can be up to an hour behind during outages. Search functionality is not available to merchants in India.

### **Parameters**

* #### **query**stringRequired

* The search query string. See [search query language](https://docs.stripe.com/search#search-query-language) and the list of supported [query fields for invoices](https://docs.stripe.com/search#query-fields-for-invoices).

* #### **limit**integer

* A limit on the number of objects to be returned. Limit can range between 1 and 100, and the default is 10\.

* #### **page**string

* A cursor for pagination across multiple pages of results. Don’t include this parameter on the first call. Use the next\_page value returned in a previous response to request subsequent results.

### **Returns**

A dictionary with a data property that contains an array of up to limit invoices. If no objects match the query, the resulting array will be empty. See the related guide on [expanding properties in lists](https://docs.stripe.com/expand#lists).  
GET /v1/invoices/search  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-G https://api.stripe.com/v1/invoices/search \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d query="total\<1"  
Response  
{  
 "object": "search\_result",  
 "url": "/v1/invoices/search",  
 "has\_more": false,  
 "data": \[  
   {  
     "id": "in\_1MtHbELkdIwHu7ixl4OzzPMv",  
     "object": "invoice",  
     "account\_country": "US",  
     "account\_name": "Stripe Docs",  
     "account\_tax\_ids": null,  
     "amount\_due": 0,  
     "amount\_paid": 0,  
     "amount\_overpaid": 0,  
     "amount\_remaining": 0,  
     "amount\_shipping": 0,  
     "application": null,  
     "attempt\_count": 0,  
     "attempted": false,  
     "auto\_advance": false,  
     "automatic\_tax": {  
       "enabled": false,  
       "liability": null,  
       "status": null  
     },  
     "billing\_reason": "manual",  
     "collection\_method": "charge\_automatically",  
     "created": 1680644467,  
     "currency": "usd",  
     "custom\_fields": null,  
     "customer": "cus\_NeZwdNtLEOXuvB",  
     "customer\_address": null,  
     "customer\_email": "jennyrosen@example.com",  
     "customer\_name": "Jenny Rosen",  
     "customer\_phone": null,  
     "customer\_shipping": null,  
     "customer\_tax\_exempt": "none",  
     "customer\_tax\_ids": \[\],  
     "default\_payment\_method": null,  
     "default\_source": null,  
     "default\_tax\_rates": \[\],  
     "description": null,  
     "discounts": \[\],  
     "due\_date": null,  
     "ending\_balance": null,  
     "footer": null,  
     "from\_invoice": null,  
     "hosted\_invoice\_url": null,  
     "invoice\_pdf": null,  
     "issuer": {  
       "type": "self"  
     },  
     "last\_finalization\_error": null,  
     "latest\_revision": null,  
     "lines": {  
       "object": "list",  
       "data": \[\],  
       "has\_more": false,  
       "total\_count": 0,  
       "url": "/v1/invoices/in\_1MtHbELkdIwHu7ixl4OzzPMv/lines"  
     },  
     "livemode": false,  
     "metadata": {},  
     "next\_payment\_attempt": null,  
     "number": null,  
     "on\_behalf\_of": null,  
     "parent": null,  
     "payment\_settings": {  
       "default\_mandate": null,  
       "payment\_method\_options": null,  
       "payment\_method\_types": null  
     },  
     "period\_end": 1680644467,  
     "period\_start": 1680644467,  
     "post\_payment\_credit\_notes\_amount": 0,  
     "pre\_payment\_credit\_notes\_amount": 0,  
     "receipt\_number": null,  
     "shipping\_cost": null,  
     "shipping\_details": null,  
     "starting\_balance": 0,  
     "statement\_descriptor": null,  
     "status": "draft",  
     "status\_transitions": {  
       "finalized\_at": null,  
       "marked\_uncollectible\_at": null,  
       "paid\_at": null,  
       "voided\_at": null  
     },  
     "subtotal": 0,  
     "subtotal\_excluding\_tax": 0,  
     "test\_clock": null,  
     "total": 0,  
     "total\_discount\_amounts": \[\],  
     "total\_excluding\_tax": 0,  
     "total\_taxes": \[\],  
     "webhooks\_delivered\_at": 1680644467  
   }  
 \]  
}

# [**Send an invoice for manual payment**](https://docs.stripe.com/api/invoices/send) 

Stripe will automatically send invoices to customers according to your [subscriptions settings](https://dashboard.stripe.com/account/billing/automatic). However, if you’d like to manually send an invoice to your customer out of the normal schedule, you can do so. When sending invoices that have already been paid, there will be no reference to the payment in the email.  
Requests made in test-mode result in no emails being sent, despite sending an invoice.sent event.

### **Parameters**

No parameters.

### **Returns**

Returns the invoice object.  
POST /v1/invoices/:id/send  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X POST https://api.stripe.com/v1/invoices/in\_1MtGmCLkdIwHu7ixJlveR2DO/send \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "in\_1MtGmCLkdIwHu7ixJlveR2DO",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": true,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "send\_invoice",  
 "created": 1680641304,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZwvqcz9Sh2uw",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": 1681246104,  
 "ending\_balance": 0,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": "https://invoice.stripe.com/i/acct\_1M2JTkLkdIwHu7ix/test\_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3SDR0Q1Q4U1N0YkVjY2lvSmRoRGppU3E1eGVJLDcxMTgyMTA10200hQIJrDM1?s=ap",  
 "invoice\_pdf": "https://pay.stripe.com/invoice/acct\_1M2JTkLkdIwHu7ix/test\_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3SDR0Q1Q4U1N0YkVjY2lvSmRoRGppU3E1eGVJLDcxMTgyMTA10200hQIJrDM1/pdf?s=ap",  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtGmCLkdIwHu7ixJlveR2DO/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": "3AB9C0CA-0001",  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680641304,  
 "period\_start": 1680641304,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "paid",  
 "status\_transitions": {  
   "finalized\_at": 1680641304,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": 1680641304,  
   "voided\_at": null  
 },  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680641304  
}

# [**Void an invoice**](https://docs.stripe.com/api/invoices/void) 

Mark a finalized invoice as void. This cannot be undone. Voiding an invoice is similar to [deletion](https://docs.stripe.com/api/payment-link/update#delete_invoice), however it only applies to finalized invoices and maintains a papertrail where the invoice can still be found.  
Consult with local regulations to determine whether and how an invoice might be amended, canceled, or voided in the jurisdiction you’re doing business in. You might need to [issue another invoice](https://docs.stripe.com/api/payment-link/update#create_invoice) or [credit note](https://docs.stripe.com/api/payment-link/update#create_credit_note) instead. Stripe recommends that you consult with your legal counsel for advice specific to your business.

### **Parameters**

No parameters.

### **Returns**

Returns the voided invoice object.  
POST /v1/invoices/:id/void  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X POST https://api.stripe.com/v1/invoices/in\_1MtGmCLkdIwHu7ix6PgS6g8S/void \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "in\_1MtGmCLkdIwHu7ix6PgS6g8S",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe Docs",  
 "account\_tax\_ids": null,  
 "amount\_due": 0,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 0,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1680644467,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_NeZwdNtLEOXuvB",  
 "customer\_address": null,  
 "customer\_email": "jennyrosen@example.com",  
 "customer\_name": "Jenny Rosen",  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[\],  
   "has\_more": false,  
   "total\_count": 0,  
   "url": "/v1/invoices/in\_1MtGmCLkdIwHu7ix6PgS6g8S/lines"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1680644467,  
 "period\_start": 1680644467,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "quote": null,  
 "receipt\_number": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "void",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subscription": null,  
 "subtotal": 0,  
 "subtotal\_excluding\_tax": 0,  
 "test\_clock": null,  
 "total": 0,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 0,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": 1680644467  
}

# [**Invoice Items**](https://docs.stripe.com/api/invoiceitems) 

Invoice Items represent the component lines of an [invoice](https://docs.stripe.com/api/invoices). An invoice item is added to an invoice by creating or updating it with an invoice field, at which point it will be included as [an invoice line item](https://docs.stripe.com/api/invoices/line_item) within [invoice.lines](https://docs.stripe.com/api/invoices/object#invoice_object-lines).  
Invoice Items can be created before you are ready to actually send the invoice. This can be particularly useful when combined with a [subscription](https://docs.stripe.com/api/subscriptions). Sometimes you want to add a charge or credit to a customer, but actually charge or credit the customer’s card only at the end of a regular billing cycle. This is useful for combining several charges (to minimize per-transaction fees), or for having Stripe tabulate your usage-based billing totals.  
Related guides: [Integrate with the Invoicing API](https://docs.stripe.com/invoicing/integration), [Subscription Invoices](https://docs.stripe.com/billing/invoices/subscription#adding-upcoming-invoice-items).

Was this section helpful?YesNo  
Endpoints  
[POST/v1/invoiceitems](https://docs.stripe.com/api/invoiceitems/create)[POST/v1/invoiceitems/:id](https://docs.stripe.com/api/invoiceitems/update)[GET/v1/invoiceitems/:id](https://docs.stripe.com/api/invoiceitems/retrieve)[GET/v1/invoiceitems](https://docs.stripe.com/api/invoiceitems/list)[DELETE/v1/invoiceitems/:id](https://docs.stripe.com/api/invoiceitems/delete)

# [**The Invoice Item object**](https://docs.stripe.com/api/invoiceitems/object) 

### **Attributes**

* #### **id**string

* Unique identifier for the object.

* #### **amount**integer

* Amount (in the currency specified) of the invoice item. This should always be equal to unit\_amount \* quantity.

* #### **currency**enum

* Three-letter [ISO currency code](https://www.iso.org/iso-4217-currency-codes.html), in lowercase. Must be a [supported currency](https://stripe.com/docs/currencies).

* #### **customer**stringExpandable

* The ID of the customer who will be billed when this invoice item is billed.

* #### **description**nullable string

* An arbitrary string attached to the object. Often useful for displaying to users.

* #### **metadata**nullable object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format.

* #### **parent**nullable object

* The parent that generated this invoice  
* Show child attributes

* #### **period**object

* The period associated with this invoice item. When set to different values, the period will be rendered on the invoice. If you have [Stripe Revenue Recognition](https://docs.stripe.com/revenue-recognition) enabled, the period will be used to recognize and defer revenue. See the [Revenue Recognition documentation](https://docs.stripe.com/revenue-recognition/methodology/subscriptions-and-invoicing) for details.  
* Show child attributes

* #### **pricing**nullable object

* The pricing information of the invoice item.  
* Show child attributes

* #### **proration**boolean

* Whether the invoice item was created automatically as a proration adjustment when the customer switched plans.

### **More attributes**

### Expand all

* #### **object**string

* #### **date**timestamp

* #### **discountable**boolean

* #### **discounts**nullable array of stringsExpandable

* #### **invoice**nullable stringExpandable

* #### **livemode**boolean

* #### **quantity**integer

* #### **tax\_rates**nullable array of objects

* #### **test\_clock**nullable stringExpandable

The Invoice Item object  
{  
 "id": "ii\_1MtGUtLkdIwHu7ixBYwjAM00",  
 "object": "invoiceitem",  
 "amount": 1099,  
 "currency": "usd",  
 "customer": "cus\_NeZei8imSbMVvi",  
 "date": 1680640231,  
 "description": "T-shirt",  
 "discountable": true,  
 "discounts": \[\],  
 "invoice": null,  
 "livemode": false,  
 "metadata": {},  
 "parent": null,  
 "period": {  
   "end": 1680640231,  
   "start": 1680640231  
 },  
 "pricing": {  
   "price\_details": {  
     "price": "price\_1MtGUsLkdIwHu7ix1be5Ljaj",  
     "product": "prod\_NeZe7xbBdJT8EN"  
   },  
   "type": "price\_details",  
   "unit\_amount\_decimal": "1099"  
 },  
 "proration": false,  
 "quantity": 1,  
 "tax\_rates": \[\],  
 "test\_clock": null  
}

# [**Create an invoice item**](https://docs.stripe.com/api/invoiceitems/create) 

Creates an item to be added to a draft invoice (up to 250 items per invoice). If no invoice is specified, the item will be on the next invoice created for the customer specified.

### **Parameters**

* #### **customer**stringRequired

* The ID of the customer who will be billed when this invoice item is billed.

* #### **amount**integer

* The integer amount in cents of the charge to be applied to the upcoming invoice. Passing in a negative amount will reduce the amount\_due on the invoice.

* #### **currency**enum

* Three-letter [ISO currency code](https://www.iso.org/iso-4217-currency-codes.html), in lowercase. Must be a [supported currency](https://stripe.com/docs/currencies).

* #### **description**string

* An arbitrary string which you can attach to the invoice item. The description is displayed in the invoice for easy tracking.

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

* #### **period**object

* The period associated with this invoice item. When set to different values, the period will be rendered on the invoice. If you have [Stripe Revenue Recognition](https://docs.stripe.com/revenue-recognition) enabled, the period will be used to recognize and defer revenue. See the [Revenue Recognition documentation](https://docs.stripe.com/revenue-recognition/methodology/subscriptions-and-invoicing) for details.  
* Show child parameters

* #### **pricing**object

* The pricing information for the invoice item.  
* Show child parameters

### **More parameters**

### Expand all

* #### **discountable**boolean

* #### **discounts**array of objects

* #### **invoice**string

* #### **price\_data**object

* #### **quantity**integer

* #### **subscription**string

* #### **tax\_behavior**enumRecommended if calculating taxes

* #### **tax\_code**stringRecommended if calculating taxes

* #### **tax\_rates**array of strings

* #### **unit\_amount\_decimal**string

### **Returns**

The created invoice item object is returned if successful. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors).  
POST /v1/invoiceitems  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoiceitems \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d customer=cus\_NeZei8imSbMVvi \\  
 \-d "pricing\[price\]"\=price\_1MtGUsLkdIwHu7ix1be5Ljaj  
Response  
{  
 "id": "ii\_1MtGUtLkdIwHu7ixBYwjAM00",  
 "object": "invoiceitem",  
 "amount": 1099,  
 "currency": "usd",  
 "customer": "cus\_NeZei8imSbMVvi",  
 "date": 1680640231,  
 "description": "T-shirt",  
 "discountable": true,  
 "discounts": \[\],  
 "invoice": null,  
 "livemode": false,  
 "metadata": {},  
 "parent": null,  
 "period": {  
   "end": 1680640231,  
   "start": 1680640231  
 },  
 "pricing": {  
   "price\_details": {  
     "price": "price\_1MtGUsLkdIwHu7ix1be5Ljaj",  
     "product": "prod\_NeZe7xbBdJT8EN"  
   },  
   "type": "price\_details",  
   "unit\_amount\_decimal": "1099"  
 },  
 "proration": false,  
 "quantity": 1,  
 "tax\_rates": \[\],  
 "test\_clock": null  
}

# [**Update an invoice item**](https://docs.stripe.com/api/invoiceitems/update) 

Updates the amount or description of an invoice item on an upcoming invoice. Updating an invoice item is only possible before the invoice it’s attached to is closed.

### **Parameters**

* #### **amount**integer

* The integer amount in cents of the charge to be applied to the upcoming invoice. If you want to apply a credit to the customer’s account, pass a negative amount.

* #### **description**string

* An arbitrary string which you can attach to the invoice item. The description is displayed in the invoice for easy tracking.

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

* #### **period**object

* The period associated with this invoice item. When set to different values, the period will be rendered on the invoice. If you have [Stripe Revenue Recognition](https://docs.stripe.com/revenue-recognition) enabled, the period will be used to recognize and defer revenue. See the [Revenue Recognition documentation](https://docs.stripe.com/revenue-recognition/methodology/subscriptions-and-invoicing) for details.  
* Show child parameters

* #### **pricing**object

* The pricing information for the invoice item.  
* Show child parameters

### **More parameters**

### Expand all

* #### **discountable**boolean

* #### **discounts**array of objects

* #### **price\_data**object

* #### **quantity**integer

* #### **tax\_behavior**enumRecommended if calculating taxes

* #### **tax\_code**stringRecommended if calculating taxes

* #### **tax\_rates**array of strings

* #### **unit\_amount\_decimal**string

### **Returns**

The updated invoice item object is returned upon success. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors).  
POST /v1/invoiceitems/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoiceitems/ii\_1MtGUtLkdIwHu7ixBYwjAM00 \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "metadata\[order\_id\]"\=6735  
Response  
{  
 "id": "ii\_1MtGUtLkdIwHu7ixBYwjAM00",  
 "object": "invoiceitem",  
 "amount": 1099,  
 "currency": "usd",  
 "customer": "cus\_NeZei8imSbMVvi",  
 "date": 1680640231,  
 "description": "T-shirt",  
 "discountable": true,  
 "discounts": \[\],  
 "invoice": null,  
 "livemode": false,  
 "metadata": {  
   "order\_id": "6735"  
 },  
 "parent": null,  
 "period": {  
   "end": 1680640231,  
   "start": 1680640231  
 },  
 "pricing": {  
   "price\_details": {  
     "price": "price\_1MtGUsLkdIwHu7ix1be5Ljaj",  
     "product": "prod\_NeZe7xbBdJT8EN"  
   },  
   "type": "price\_details",  
   "unit\_amount\_decimal": "1099"  
 },  
 "proration": false,  
 "quantity": 1,  
 "tax\_rates": \[\],  
 "test\_clock": null  
}

# [**Retrieve an invoice item**](https://docs.stripe.com/api/invoiceitems/retrieve) 

Retrieves the invoice item with the given ID.

### **Parameters**

No parameters.

### **Returns**

Returns an invoice item if a valid invoice item ID was provided. Raises [an error](https://docs.stripe.com/api/payment-link/update#errors) otherwise.  
GET /v1/invoiceitems/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoiceitems/ii\_1MtGUtLkdIwHu7ixBYwjAM00 \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "ii\_1MtGUtLkdIwHu7ixBYwjAM00",  
 "object": "invoiceitem",  
 "amount": 1099,  
 "currency": "usd",  
 "customer": "cus\_NeZei8imSbMVvi",  
 "date": 1680640231,  
 "description": "T-shirt",  
 "discountable": true,  
 "discounts": \[\],  
 "invoice": null,  
 "livemode": false,  
 "metadata": {},  
 "parent": null,  
 "period": {  
   "end": 1680640231,  
   "start": 1680640231  
 },  
 "pricing": {  
   "price\_details": {  
     "price": "price\_1MtGUsLkdIwHu7ix1be5Ljaj",  
     "product": "prod\_NeZe7xbBdJT8EN"  
   },  
   "type": "price\_details",  
   "unit\_amount\_decimal": "1099"  
 },  
 "proration": false,  
 "quantity": 1,  
 "tax\_rates": \[\],  
 "test\_clock": null  
}

# [**List all invoice items**](https://docs.stripe.com/api/invoiceitems/list) 

Returns a list of your invoice items. Invoice items are returned sorted by creation date, with the most recently created invoice items appearing first.

### **Parameters**

* #### **customer**string

* The identifier of the customer whose invoice items to return. If none is provided, all invoice items will be returned.

### **More parameters**

### Expand all

* #### **created**object

* #### **ending\_before**string

* #### **invoice**string

* #### **limit**integer

* #### **pending**boolean

* #### **starting\_after**string

### **Returns**

A dictionary with a data property that contains an array of up to limit invoice items, starting after invoice item starting\_after. Each entry in the array is a separate invoice item object. If no more invoice items are available, the resulting array will be empty.  
GET /v1/invoiceitems  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-G https://api.stripe.com/v1/invoiceitems \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d limit=3  
Response  
{  
 "object": "list",  
 "url": "/v1/invoiceitems",  
 "has\_more": false,  
 "data": \[  
   {  
     "id": "ii\_1MtGUtLkdIwHu7ixBYwjAM00",  
     "object": "invoiceitem",  
     "amount": 1099,  
     "currency": "usd",  
     "customer": "cus\_NeZei8imSbMVvi",  
     "date": 1680640231,  
     "description": "T-shirt",  
     "discountable": true,  
     "discounts": \[\],  
     "invoice": null,  
     "livemode": false,  
     "metadata": {},  
     "parent": null,  
     "period": {  
       "end": 1680640231,  
       "start": 1680640231  
     },  
     "pricing": {  
       "price\_details": {  
         "price": "price\_1MtGUsLkdIwHu7ix1be5Ljaj",  
         "product": "prod\_NeZe7xbBdJT8EN"  
       },  
       "type": "price\_details",  
       "unit\_amount\_decimal": "1099"  
     },  
     "proration": false,  
     "quantity": 1,  
     "tax\_rates": \[\],  
     "test\_clock": null  
   }  
 \]  
}

# [**Delete an invoice item**](https://docs.stripe.com/api/invoiceitems/delete) 

Deletes an invoice item, removing it from an invoice. Deleting invoice items is only possible when they’re not attached to invoices, or if it’s attached to a draft invoice.

### **Parameters**

No parameters.

### **Returns**

An object with the deleted invoice item’s ID and a deleted flag upon success. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors), such as if the invoice item has already been deleted.  
DELETE /v1/invoiceitems/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X DELETE https://api.stripe.com/v1/invoiceitems/ii\_1MtGUtLkdIwHu7ixBYwjAM00 \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "ii\_1MtGUtLkdIwHu7ixBYwjAM00",  
 "object": "invoiceitem",  
 "deleted": true  
}

# [**Invoice Line Item**](https://docs.stripe.com/api/invoice-line-item) 

Invoice Line Items represent the individual lines within an [invoice](https://docs.stripe.com/api/invoices) and only exist within the context of an invoice.  
Each line item is backed by either an [invoice item](https://docs.stripe.com/api/invoiceitems) or a [subscription item](https://docs.stripe.com/api/subscription_items).

Was this section helpful?YesNo  
Endpoints  
[POST/v1/invoices/:id/lines/:id](https://docs.stripe.com/api/invoice-line-item/update)[GET/v1/invoices/:id/lines](https://docs.stripe.com/api/invoice-line-item/retrieve)[POST/v1/invoices/:id/add\_lines](https://docs.stripe.com/api/invoice-line-item/bulk)[POST/v1/invoices/:id/remove\_lines](https://docs.stripe.com/api/invoice-line-item/invoices/remove-lines/bulk)[POST/v1/invoices/:id/update\_lines](https://docs.stripe.com/api/invoice-line-item/invoices/update-lines/bulk)

# [**The Invoice Line Item object**](https://docs.stripe.com/api/invoice-line-item/object) 

### **Attributes**

* #### **id**string

* Unique identifier for the object.

* #### **amount**integer

* The amount, in cents.

* #### **currency**enum

* Three-letter [ISO currency code](https://www.iso.org/iso-4217-currency-codes.html), in lowercase. Must be a [supported currency](https://stripe.com/docs/currencies).

* #### **description**nullable string

* An arbitrary string attached to the object. Often useful for displaying to users.

* #### **invoice**nullable string

* The ID of the invoice that contains this line item.

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Note that for line items with type=subscription, metadata reflects the current metadata from the subscription associated with the line item, unless the invoice line was directly updated with different metadata after creation.

* #### **parent**nullable object

* The parent that generated this invoice  
* Show child attributes

* #### **period**object

* The period this line\_item covers. For subscription line items, this is the subscription period. For prorations, this starts when the proration was calculated, and ends at the period end of the subscription. For invoice items, this is the time at which the invoice item was created or the period of the item. If you have [Stripe Revenue Recognition](https://docs.stripe.com/revenue-recognition) enabled, the period will be used to recognize and defer revenue. See the [Revenue Recognition documentation](https://docs.stripe.com/revenue-recognition/methodology/subscriptions-and-invoicing) for details.  
* Show child attributes

* #### **pricing**nullable object

* The pricing information of the line item.  
* Show child attributes

* #### **quantity**nullable integer

* The quantity of the subscription, if the line item is a subscription or a proration.

### **More attributes**

### Expand all

* #### **object**string

* #### **discount\_amounts**nullable array of objects

* #### **discountable**boolean

* #### **discounts**array of stringsExpandable

* #### **livemode**boolean

* #### **pretax\_credit\_amounts**nullable array of objects

* #### **taxes**nullable array of objects

The Invoice Line Item object  
{  
 "id": "il\_tmp\_1Nzo1ZGgdF1VjufLzD1UUn9R",  
 "object": "line\_item",  
 "amount": 1000,  
 "currency": "usd",  
 "description": "My First Invoice Item (created for API docs)",  
 "discount\_amounts": \[\],  
 "discountable": true,  
 "discounts": \[\],  
 "livemode": false,  
 "metadata": {},  
 "parent": {  
   "type": "invoice\_item\_details",  
   "invoice\_item\_details": {  
     "invoice\_item": "ii\_1NpHiK2eZvKYlo2C9NdV8VrI",  
     "proration": false,  
     "proration\_details": {  
       "credited\_items": null  
     },  
     "subscription": null  
   }  
 },  
 "period": {  
   "end": 1696975413,  
   "start": 1696975413  
 },  
 "pricing": {  
   "price\_details": {  
     "price": "price\_1NzlYfGgdF1VjufL0cVjLJVI",  
     "product": "prod\_OnMHDH6VBmYlTr"  
   },  
   "type": "price\_details",  
   "unit\_amount\_decimal": "1000"  
 },  
 "quantity": 1,  
 "taxes": \[\]  
}

# [**Update an invoice's line item**](https://docs.stripe.com/api/invoice-line-item/update) 

Updates an invoice’s line item. Some fields, such as tax\_amounts, only live on the invoice line item, so they can only be updated through this endpoint. Other fields, such as amount, live on both the invoice item and the invoice line item, so updates on this endpoint will propagate to the invoice item as well. Updating an invoice’s line item is only possible before the invoice is finalized.

### **Parameters**

* #### **invoice**stringRequired

* Invoice ID of line item

* #### **line\_item\_id**stringRequired

* Invoice line item ID

* #### **amount**integer

* The integer amount in cents of the charge to be applied to the upcoming invoice. If you want to apply a credit to the customer’s account, pass a negative amount.

* #### **description**string

* An arbitrary string which you can attach to the invoice item. The description is displayed in the invoice for easy tracking.

* #### **metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata. For [type=subscription](https://docs.stripe.com/api/invoices/line_item#invoice_line_item_object-type) line items, the incoming metadata specified on the request is directly used to set this value, in contrast to [type=invoiceitem](https://docs.stripe.com/api/payment-link/api/invoices/line_item#invoice_line_item_object-type) line items, where any existing metadata on the invoice line is merged with the incoming data.

* #### **period**object

* The period associated with this invoice item. When set to different values, the period will be rendered on the invoice. If you have [Stripe Revenue Recognition](https://docs.stripe.com/revenue-recognition) enabled, the period will be used to recognize and defer revenue. See the [Revenue Recognition documentation](https://docs.stripe.com/revenue-recognition/methodology/subscriptions-and-invoicing) for details.  
* Show child parameters

* #### **pricing**object

* The pricing information for the invoice item.  
* Show child parameters

* #### **quantity**integer

* Non-negative integer. The quantity of units for the line item.

### **More parameters**

### Expand all

* #### **discountable**boolean

* #### **discounts**array of objects

* #### **price\_data**object

* #### **tax\_amounts**array of objects

* #### **tax\_rates**array of strings

### **Returns**

The updated invoice’s line item object is returned upon success. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors).  
POST /v1/invoices/:id/lines/:id  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl \-X POST https://api.stripe.com/v1/invoices/in\_1NuhUa2eZvKYlo2CWYVhyvD9/lines/il\_tmp\_1Nzo1ZGgdF1VjufLzD1UUn9R \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "id": "il\_tmp\_1Nzo1ZGgdF1VjufLzD1UUn9R",  
 "object": "line\_item",  
 "amount": 1000,  
 "currency": "usd",  
 "description": "My First Invoice Item (created for API docs)",  
 "discount\_amounts": \[\],  
 "discountable": true,  
 "discounts": \[\],  
 "livemode": false,  
 "metadata": {},  
 "parent": {  
   "type": "invoice\_item\_details",  
   "invoice\_item\_details": {  
     "invoice\_item": "ii\_1Nzo1ZGgdF1VjufLzD1UUn9R",  
     "proration": false,  
     "proration\_details": {  
       "credited\_items": null  
     },  
     "subscription": null  
   }  
 },  
 "period": {  
   "end": 1696975413,  
   "start": 1696975413  
 },  
 "pricing": {  
   "price\_details": {  
     "price": "price\_1NzlYfGgdF1VjufL0cVjLJVI",  
     "product": "prod\_OnMHDH6VBmYlTr"  
   },  
   "type": "price\_details",  
   "unit\_amount\_decimal": "1000"  
 },  
 "quantity": 1,  
 "taxes": \[\]  
}

# [**Retrieve an invoice's line items**](https://docs.stripe.com/api/invoice-line-item/retrieve) 

When retrieving an invoice, you’ll get a **lines** property containing the total count of line items and the first handful of those items. There is also a URL where you can retrieve the full (paginated) list of line items.

### **Parameters**

No parameters.

### **More parameters**

### Expand all

* #### **ending\_before**string

* #### **limit**integer

* #### **starting\_after**string

### **Returns**

Returns a list of [line\_item objects](https://docs.stripe.com/api/payment-link/update#invoice_line_item_object).  
GET /v1/invoices/:id/lines  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices/in\_1NpHok2eZvKYlo2CyeiBref0/lines \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:"  
Response  
{  
 "object": "list",  
 "url": "/v1/invoices/in\_1NpHiG2eZvKYlo2CZV0ZkEBT/lines",  
 "has\_more": false,  
 "data": \[  
   {  
     "id": "il\_tmp\_1NpHiK2eZvKYlo2C9NdV8VrI",  
     "object": "line\_item",  
     "amount": 129999,  
     "currency": "usd",  
     "description": "My First Invoice Item (created for API docs)",  
     "discount\_amounts": \[\],  
     "discountable": true,  
     "discounts": \[\],  
     "livemode": false,  
     "metadata": {},  
     "parent": {  
       "type": "invoice\_item\_details",  
       "invoice\_item\_details": {  
         "invoice\_item": "ii\_1NpHiK2eZvKYlo2C9NdV8VrI",  
         "proration": false,  
         "proration\_details": {  
           "credited\_items": null  
         },  
         "subscription": null  
       }  
     },  
     "period": {  
       "end": 1694467932,  
       "start": 1694467932  
     },  
     "pricing": {  
       "price\_details": {  
         "price": "price\_1NpEIa2eZvKYlo2CXcy5DRPA",  
         "product": "prod\_OcTFTbV7qh48bd"  
       },  
       "type": "price\_details",  
       "unit\_amount\_decimal": "129999"  
     },  
     "quantity": 1,  
     "taxes": \[\]  
   }  
 \]  
}

# [**Bulk add invoice line items**](https://docs.stripe.com/api/invoice-line-item/bulk) 

Adds multiple line items to an invoice. This is only possible when an invoice is still a draft.

### **Parameters**

* #### **lines**array of objectsRequired

* The line items to add.  
* Show child parameters

* #### **invoice\_metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

### **Returns**

The updated invoice with newly added line items is returned upon success. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors).  
POST /v1/invoices/:id/add\_lines  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices/in\_1NuhUa2eZvKYlo2CWYVhyvD9/add\_lines \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "lines\[0\]\[description\]"\="test description" \\  
 \-d "lines\[0\]\[amount\]"\=799 \\  
 \-d "lines\[1\]\[invoice\_item\]"\=ii\_1NuLVd2eZvKYlo2CRWY0Hqgi  
Response  
{  
 "id": "in\_1NuhUa2eZvKYlo2CWYVhyvD9",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe.com",  
 "account\_tax\_ids": null,  
 "amount\_due": 998,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 998,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1695758664,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_9s6XKzkNRiz8i3",  
 "customer\_address": null,  
 "customer\_email": "test@test.com",  
 "customer\_name": null,  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "effective\_at": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[  
     {  
       "id": "il\_1NuhUa2eZvKYlo2CC98Fg3Bo",  
       "object": "line\_item",  
       "amount": 799,  
       "currency": "usd",  
       "description": "test description",  
       "discount\_amounts": \[\],  
       "discountable": true,  
       "discounts": \[\],  
       "livemode": false,  
       "metadata": {},  
       "parent": {  
         "type": "invoice\_item\_details",  
         "invoice\_item\_details": {  
           "invoice\_item": "ii\_1NuhUa2eZvKYlo2CGeF7Qgx0",  
           "proration": false,  
           "proration\_details": {  
             "credited\_items": null  
           },  
           "subscription": null  
         }  
       },  
       "period": {  
         "end": 1695758664,  
         "start": 1695758664  
       },  
       "pricing": {  
         "price\_details": {  
           "price": "price\_1NuhLA2eZvKYlo2Cq1tIGEBp",  
           "product": "prod\_Oi7aO1GPi1dWX7"  
         },  
         "type": "price\_details",  
         "unit\_amount\_decimal": "799"  
       },  
       "quantity": 1,  
       "taxes": \[\]  
     },  
     {  
       "id": "il\_1NuLVe2eZvKYlo2Canh35EfU",  
       "object": "line\_item",  
       "amount": 199,  
       "currency": "usd",  
       "description": "Canned Coffee",  
       "discount\_amounts": \[\],  
       "discountable": true,  
       "discounts": \[\],  
       "livemode": false,  
       "metadata": {},  
       "parent": {  
         "type": "invoice\_item\_details",  
         "invoice\_item\_details": {  
           "invoice\_item": "ii\_1NuLVd2eZvKYlo2CRWY0Hqgi",  
           "proration": false,  
           "proration\_details": {  
             "credited\_items": null  
           },  
           "subscription": null  
         }  
       },  
       "period": {  
         "end": 1695674161,  
         "start": 1695674161  
       },  
       "pricing": {  
         "price\_details": {  
           "price": "price\_1NuI212eZvKYlo2CWgdD8kET",  
           "product": "prod\_OhhQNWDYdIbXYv"  
         },  
         "type": "price\_details",  
         "unit\_amount\_decimal": "199"  
       },  
       "quantity": 1,  
       "taxes": \[\]  
     }  
   \],  
   "has\_more": false,  
   "url": "/v1/invoices/upcoming/lines?customer=cus\_9s6XKzkNRiz8i3"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1688482163,  
 "period\_start": 1688395763,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "redaction": null,  
 "rendering": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 998,  
 "subtotal\_excluding\_tax": 998,  
 "test\_clock": null,  
 "total": 998,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 998,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": null  
}

# [**Bulk remove invoice line items**](https://docs.stripe.com/api/invoice-line-item/invoices/remove-lines/bulk) 

Removes multiple line items from an invoice. This is only possible when an invoice is still a draft.

### **Parameters**

* #### **lines**array of objectsRequired

* The line items to remove.  
* Show child parameters

* #### **invoice\_metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata.

### **Returns**

The updated invoice without the removed line items is returned upon success. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors).  
POST /v1/invoices/:id/remove\_lines  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices/in\_1NuhUa2eZvKYlo2CWYVhyvD9/remove\_lines \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "lines\[0\]\[id\]"\=il\_1NuhUa2eZvKYlo2CC98Fg3Bo \\  
 \-d "lines\[0\]\[behavior\]"\=delete \\  
 \-d "lines\[1\]\[id\]"\=il\_1NuLVe2eZvKYlo2Canh35EfU \\  
 \-d "lines\[1\]\[behavior\]"\=unassign  
Response  
{  
 "id": "in\_1NuhUa2eZvKYlo2CWYVhyvD9",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe.com",  
 "account\_tax\_ids": null,  
 "amount\_due": 998,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 998,  
 "amount\_shipping": 0,  
 "application": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1695758664,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_9s6XKzkNRiz8i3",  
 "customer\_address": null,  
 "customer\_email": "test@test.com",  
 "customer\_name": null,  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "effective\_at": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[  
     {  
       "id": "il\_1NuhUa2eZvKYlo2CC98Fg3Bo",  
       "object": "line\_item",  
       "amount": 799,  
       "currency": "usd",  
       "description": "test description",  
       "discount\_amounts": \[\],  
       "discountable": true,  
       "discounts": \[\],  
       "livemode": false,  
       "metadata": {},  
       "parent": {  
         "type": "invoice\_item\_details",  
         "invoice\_item\_details": {  
           "invoice\_item": "ii\_1NuhUa2eZvKYlo2CGeF7Qgx0",  
           "proration": false,  
           "proration\_details": {  
             "credited\_items": null  
           },  
           "subscription": null  
         }  
       },  
       "period": {  
         "end": 1695758664,  
         "start": 1695758664  
       },  
       "pricing": {  
         "price\_details": {  
           "price": "price\_1NuhLA2eZvKYlo2Cq1tIGEBp",  
           "product": "prod\_Oi7aO1GPi1dWX7"  
         },  
         "type": "price\_details",  
         "unit\_amount\_decimal": "799"  
       },  
       "quantity": 1,  
       "taxes": \[\]  
     },  
     {  
       "id": "il\_1NuLVe2eZvKYlo2Canh35EfU",  
       "object": "line\_item",  
       "amount": 199,  
       "currency": "usd",  
       "description": "Canned Coffee",  
       "discount\_amounts": \[\],  
       "discountable": true,  
       "discounts": \[\],  
       "livemode": false,  
       "metadata": {},  
       "parent": {  
         "type": "invoice\_item\_details",  
         "invoice\_item\_details": {  
           "invoice\_item": "ii\_1NuLVd2eZvKYlo2CRWY0Hqgi",  
           "proration": false,  
           "proration\_details": {  
             "credited\_items": null  
           },  
           "subscription": null  
         }  
       },  
       "period": {  
         "end": 1695674161,  
         "start": 1695674161  
       },  
       "pricing": {  
         "price\_details": {  
           "price": "price\_1NuI212eZvKYlo2CWgdD8kET",  
           "product": "prod\_OhhQNWDYdIbXYv"  
         },  
         "type": "price\_details",  
         "unit\_amount\_decimal": "199"  
       },  
       "quantity": 1,  
       "taxes": \[\]  
     }  
   \],  
   "has\_more": false,  
   "url": "/v1/invoices/upcoming/lines?customer=cus\_9s6XKzkNRiz8i3"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1688482163,  
 "period\_start": 1688395763,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "redaction": null,  
 "rendering": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 998,  
 "subtotal\_excluding\_tax": 998,  
 "test\_clock": null,  
 "total": 998,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 998,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": null  
}

# [**Bulk update invoice line items**](https://docs.stripe.com/api/invoice-line-item/invoices/update-lines/bulk) 

Updates multiple line items on an invoice. This is only possible when an invoice is still a draft.

### **Parameters**

* #### **lines**array of objectsRequired

* The line items to update.  
* Show child parameters

* #### **invoice\_metadata**object

* Set of [key-value pairs](https://docs.stripe.com/api/metadata) that you can attach to an object. This can be useful for storing additional information about the object in a structured format. Individual keys can be unset by posting an empty value to them. All keys can be unset by posting an empty value to metadata. For [type=subscription](https://docs.stripe.com/api/invoices/line_item#invoice_line_item_object-type) line items, the incoming metadata specified on the request is directly used to set this value, in contrast to [type=invoiceitem](https://docs.stripe.com/api/payment-link/api/invoices/line_item#invoice_line_item_object-type) line items, where any existing metadata on the invoice line is merged with the incoming data.

### **Returns**

The updated invoice is returned upon success. Otherwise, this call raises [an error](https://docs.stripe.com/api/payment-link/update#errors).  
POST /v1/invoices/:id/update\_lines  
Server-side language  
cURLStripe CLIRubyPythonPHPJavaNode.jsGo.NET  
curl https://api.stripe.com/v1/invoices/in\_1NuhUa2eZvKYlo2CWYVhyvD9/update\_lines \\  
 \-u "sk\_test\_51QRwPI...tS00koXXd9eN  
sk\_test\_51QRwPIE7hS91Jde2H5hJ5huo5VFHGTWfx1AvSemHV4U5Z97GXKsT5XhckbITDK80TbjYqF64YgfjmweqdK7OfhtS00koXXd9eN  
:" \\  
 \-d "lines\[0\]\[id\]"\=il\_1NuhUa2eZvKYlo2CC98Fg3Bo \\  
 \-d "lines\[0\]\[description\]"\="test description"  
Response  
{  
 "id": "in\_1NuhUa2eZvKYlo2CWYVhyvD9",  
 "object": "invoice",  
 "account\_country": "US",  
 "account\_name": "Stripe.com",  
 "account\_tax\_ids": null,  
 "amount\_due": 998,  
 "amount\_paid": 0,  
 "amount\_overpaid": 0,  
 "amount\_remaining": 998,  
 "amount\_shipping": 0,  
 "application": null,  
 "application\_fee\_amount": null,  
 "attempt\_count": 0,  
 "attempted": false,  
 "auto\_advance": false,  
 "automatic\_tax": {  
   "enabled": false,  
   "liability": null,  
   "status": null  
 },  
 "billing\_reason": "manual",  
 "collection\_method": "charge\_automatically",  
 "created": 1695758664,  
 "currency": "usd",  
 "custom\_fields": null,  
 "customer": "cus\_9s6XKzkNRiz8i3",  
 "customer\_address": null,  
 "customer\_email": "test@test.com",  
 "customer\_name": null,  
 "customer\_phone": null,  
 "customer\_shipping": null,  
 "customer\_tax\_exempt": "none",  
 "customer\_tax\_ids": \[\],  
 "default\_payment\_method": null,  
 "default\_source": null,  
 "default\_tax\_rates": \[\],  
 "description": null,  
 "discounts": \[\],  
 "due\_date": null,  
 "effective\_at": null,  
 "ending\_balance": null,  
 "footer": null,  
 "from\_invoice": null,  
 "hosted\_invoice\_url": null,  
 "invoice\_pdf": null,  
 "issuer": {  
   "type": "self"  
 },  
 "last\_finalization\_error": null,  
 "latest\_revision": null,  
 "lines": {  
   "object": "list",  
   "data": \[  
     {  
       "id": "il\_1NuhUa2eZvKYlo2CC98Fg3Bo",  
       "object": "line\_item",  
       "amount": 799,  
       "currency": "usd",  
       "description": "test description",  
       "discount\_amounts": \[\],  
       "discountable": true,  
       "discounts": \[\],  
       "invoice\_item": "ii\_1NuhUa2eZvKYlo2CGeF7Qgx0",  
       "livemode": false,  
       "metadata": {},  
       "period": {  
         "end": 1695758664,  
         "start": 1695758664  
       },  
       "pricing": {  
         "price\_details": {  
           "price": "price\_1NuhLA2eZvKYlo2Cq1tIGEBp",  
           "product": "prod\_Oi7aO1GPi1dWX7"  
         },  
         "type": "price\_details",  
         "unit\_amount\_decimal": "799"  
       },  
       "proration": false,  
       "proration\_details": {  
         "credited\_items": null  
       },  
       "quantity": 1,  
       "subscription": null,  
       "taxes": \[\]  
     },  
     {  
       "id": "il\_1NuLVe2eZvKYlo2Canh35EfU",  
       "object": "line\_item",  
       "amount": 199,  
       "currency": "usd",  
       "description": "Canned Coffee",  
       "discount\_amounts": \[\],  
       "discountable": true,  
       "discounts": \[\],  
       "invoice\_item": "ii\_1NuLVd2eZvKYlo2CRWY0Hqgi",  
       "livemode": false,  
       "metadata": {},  
       "period": {  
         "end": 1695674161,  
         "start": 1695674161  
       },  
       "pricing": {  
         "price\_details": {  
           "price": "price\_1NuI212eZvKYlo2CWgdD8kET",  
           "product": "prod\_OhhQNWDYdIbXYv"  
         },  
         "type": "price\_details",  
         "unit\_amount\_decimal": "199"  
       },  
       "proration": false,  
       "proration\_details": {  
         "credited\_items": null  
       },  
       "quantity": 1,  
       "subscription": null,  
       "taxes": \[\],  
       "type": "invoiceitem"  
     }  
   \],  
   "has\_more": false,  
   "url": "/v1/invoices/upcoming/lines?customer=cus\_9s6XKzkNRiz8i3"  
 },  
 "livemode": false,  
 "metadata": {},  
 "next\_payment\_attempt": null,  
 "number": null,  
 "on\_behalf\_of": null,  
 "parent": null,  
 "payment\_settings": {  
   "default\_mandate": null,  
   "payment\_method\_options": null,  
   "payment\_method\_types": null  
 },  
 "period\_end": 1688482163,  
 "period\_start": 1688395763,  
 "post\_payment\_credit\_notes\_amount": 0,  
 "pre\_payment\_credit\_notes\_amount": 0,  
 "receipt\_number": null,  
 "redaction": null,  
 "rendering": null,  
 "shipping\_cost": null,  
 "shipping\_details": null,  
 "starting\_balance": 0,  
 "statement\_descriptor": null,  
 "status": "draft",  
 "status\_transitions": {  
   "finalized\_at": null,  
   "marked\_uncollectible\_at": null,  
   "paid\_at": null,  
   "voided\_at": null  
 },  
 "subtotal": 998,  
 "subtotal\_excluding\_tax": 998,  
 "test\_clock": null,  
 "total": 998,  
 "total\_discount\_amounts": \[\],  
 "total\_excluding\_tax": 998,  
 "total\_taxes": \[\],  
 "webhooks\_delivered\_at": null  
}

# [**Invoice Payment**](https://docs.stripe.com/api/invoice-payment) 

The invoice payment object  
Endpoints  
[GET/v1/invoice\_payments/:id](https://docs.stripe.com/api/invoice-payment/retrieve)[GET/v1/invoice\_payments](https://docs.stripe.com/api/invoice-payment/list)

## **I tried this \- but it doesn’t work\!** 

IN CASE THIS DOESN’T WORK \- THERE ARE 2 COMMON ISSUES, THAT CAN BE ADDRESSED BY SWITCHING TO CHAT MODE AND ASKING LOVABLE ABOUT THESE TWO QUESTIONS: 

* **Ask lovable to verify and confirm that your project runs in deno runtime.** 

Integrating Stripe payments in a React application using Deno edge functions involves several steps: 

• Set up Stripe:   
	• Create a Stripe account and obtain your API keys (publishable and secret).   
	• Install the Stripe React Native SDK in your React Native project: 

    npm install @stripe/stripe-react-native

• Initialize Stripe in React Native:   
	• Wrap your payment screen or app with the StripeProvider component, providing your publishable key: 

    import { StripeProvider } from '@stripe/stripe-react-native';

    function App() {  
      return (  
        \<StripeProvider publishableKey="YOUR\_PUBLISHABLE\_KEY"\>  
          {/\* Your app code \*/}  
        \</StripeProvider\>  
      );  
    }

• Create a Deno Edge Function:   
	• Set up a Deno environment and create a new Deno file (e.g., stripe\_payment.ts).   
	• Import the Stripe library for Deno: 

    import Stripe from 'stripe';  
    const stripe \= new Stripe(Deno.env.get("STRIPE\_API\_KEY") as string, {  
        apiVersion: "2025-02-24.acacia",  
      });

• Define a function to handle payment requests, using your secret key to interact with the Stripe API. For example, to create a payment intent: 

    Deno.serve(async (req) \=\> {  
      if (req.method \=== "POST") {  
        try {  
          const { amount, currency } \= await req.json();  
          const paymentIntent \= await stripe.paymentIntents.create({  
            amount,  
            currency,  
          });  
          return new Response(JSON.stringify({ clientSecret: paymentIntent.client\_secret }), {  
            status: 200,  
            headers: { "content-type": "application/json" },  
          });  
        } catch (error) {  
          return new Response(JSON.stringify({ error: error.message }), {  
            status: 400,  
            headers: { "content-type": "application/json" },  
          });  
        }  
      } else {  
         return new Response("Method not allowed", { status: 405 });  
      }  
    });

• Call the Edge Function from React Native:   
	• Use fetch or a similar method to send a request to your Deno edge function endpoint.   
	• Handle the response and use the client secret to confirm the payment on the client side using Stripe's SDK. 

    import { useStripe } from '@stripe/stripe-react-native';  
    // ...  
    const { confirmPayment, handlePaymentMethod } \= useStripe();

    const handlePayPress \= async () \=\> {  
      const response \= await fetch('YOUR\_DENO\_EDGE\_FUNCTION\_URL', {  
        method: 'POST',  
        headers: {  
          'Content-Type': 'application/json',  
        },  
        body: JSON.stringify({  
          amount: 1000, // Amount in cents  
          currency: 'usd',  
        }),  
      });  
      const data \= await response.json();

      if (data.clientSecret) {  
        const { error, paymentIntent } \= await confirmPayment(data.clientSecret, {  
          type: 'card',  
          billing\_details: {  
            name: 'Jane Doe',  
          },  
        });

        if (error) {  
          console.error(error);  
        } else if (paymentIntent) {  
          console.log('Payment successful\!', paymentIntent);  
        }  
      }  
    };

• Security Considerations:   
	• Ensure your Stripe secret key is stored securely and not exposed in your client-side code.   
	• Implement proper error handling and validation to prevent security vulnerabilities.   
	• Consider using webhooks to handle asynchronous events like payment confirmation. 

* **Check with lovable if you have WEB CRYPTO API configuration properly setup**

The Web Crypto API is a browser-based interface for performing cryptographic operations within web applications, including those built with React. It enables developers to implement secure features like encryption, decryption, hashing, and digital signatures without relying on external libraries.

To use the Web Crypto API in a React application, you can access it through the window.crypto property. The SubtleCrypto interface, available via window.crypto.subtle, provides methods for various cryptographic operations.

Here's a basic example of how to use the Web Crypto API to generate a random key and encrypt data in a React component:

import React, { useState } from 'react';

function EncryptionComponent() {  
  const \[encryptedData, setEncryptedData\] \= useState('');

  const handleEncrypt \= async () \=\> {  
    const key \= await window.crypto.subtle.generateKey(  
      {  
        name: 'AES-GCM',  
        length: 256,  
      },  
      true,  
      \['encrypt', 'decrypt'\]  
    );

    const iv \= window.crypto.getRandomValues(new Uint8Array(12));  
    const data \= new TextEncoder().encode('Secret message');

    const encrypted \= await window.crypto.subtle.encrypt(  
      {  
        name: 'AES-GCM',  
        iv: iv,  
      },  
      key,  
      data  
    );

    setEncryptedData(Array.from(new Uint8Array(encrypted)).join(','));  
  };

  return (  
    \<div\>  
      \<button onClick={handleEncrypt}\>Encrypt Data\</button\>  
      {encryptedData && \<p\>Encrypted Data: {encryptedData}\</p\>}  
    \</div\>  
  );  
}

export default EncryptionComponent;

This example demonstrates the basic steps of generating a key, encrypting data, and displaying the result. For real-world applications, more robust error handling, key management, and data formatting should be implemented.