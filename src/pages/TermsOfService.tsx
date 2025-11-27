import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const TermsOfService = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">
          Last Updated: {new Date().toLocaleDateString()}
        </p>

        <div className="prose prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Agreement to Terms</h2>
            <p className="text-foreground/80 leading-relaxed">
              By accessing or using BidBox ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Description of Service</h2>
            <p className="text-foreground/80 leading-relaxed">
              BidBox provides a digital bid room platform that enables general contractors to share project documents and collect subcontractor quotes. The Service facilitates communication and document exchange related to construction bidding processes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. User Accounts</h2>
            <h3 className="text-xl font-medium mb-3 mt-4">3.1 Account Creation</h3>
            <p className="text-foreground/80 leading-relaxed mb-4">
              General contractors must create an account to use the Service. You agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li>Provide accurate, current, and complete information</li>
              <li>Maintain and update your information as needed</li>
              <li>Maintain the security of your account credentials</li>
              <li>Accept responsibility for all activities under your account</li>
              <li>Notify us immediately of unauthorized access</li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-4">3.2 Account Eligibility</h3>
            <p className="text-foreground/80 leading-relaxed">
              You must be at least 18 years old and have the legal capacity to enter into binding contracts to use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Acceptable Use</h2>
            <p className="text-foreground/80 leading-relaxed mb-4">
              You agree not to:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li>Use the Service for any unlawful purpose</li>
              <li>Upload malicious code, viruses, or harmful content</li>
              <li>Infringe on intellectual property rights</li>
              <li>Harass, abuse, or harm other users</li>
              <li>Impersonate any person or entity</li>
              <li>Attempt to gain unauthorized access to the Service</li>
              <li>Interfere with the Service's operation</li>
              <li>Scrape, copy, or extract data through automated means</li>
              <li>Share access credentials with unauthorized parties</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Content and Files</h2>
            <h3 className="text-xl font-medium mb-3 mt-4">5.1 Your Content</h3>
            <p className="text-foreground/80 leading-relaxed">
              You retain ownership of all content and files you upload. By uploading content, you grant BidBox a license to store, process, and display your content as necessary to provide the Service.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-4">5.2 Content Responsibility</h3>
            <p className="text-foreground/80 leading-relaxed">
              You are solely responsible for the accuracy, legality, and appropriateness of content you upload. You warrant that you have all necessary rights to share the content and that it does not violate any laws or third-party rights.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-4">5.3 Content Removal</h3>
            <p className="text-foreground/80 leading-relaxed">
              We reserve the right to remove content that violates these Terms or applicable laws without prior notice.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Intellectual Property</h2>
            <p className="text-foreground/80 leading-relaxed">
              The Service, including its design, functionality, code, and trademarks, is owned by BidBox and protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works without our express written permission.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Payment Terms</h2>
            <h3 className="text-xl font-medium mb-3 mt-4">7.1 Fees</h3>
            <p className="text-foreground/80 leading-relaxed">
              Certain features may require payment. All fees are stated in USD and are non-refundable unless otherwise specified. We reserve the right to modify pricing with reasonable notice.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-4">7.2 Billing</h3>
            <p className="text-foreground/80 leading-relaxed">
              You authorize us to charge your designated payment method for all fees incurred. Failure to pay may result in service suspension or termination.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Service Availability</h2>
            <p className="text-foreground/80 leading-relaxed">
              We strive to maintain service availability but do not guarantee uninterrupted access. We may suspend or discontinue the Service for maintenance, updates, or unforeseen circumstances without liability.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Disclaimers</h2>
            <p className="text-foreground/80 leading-relaxed mb-4">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES INCLUDING:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li>Merchantability and fitness for a particular purpose</li>
              <li>Accuracy or reliability of content</li>
              <li>Uninterrupted or error-free operation</li>
              <li>Security of data transmission</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">10. Limitation of Liability</h2>
            <p className="text-foreground/80 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, BIDBOX SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE TWELVE MONTHS PRECEDING THE CLAIM.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Indemnification</h2>
            <p className="text-foreground/80 leading-relaxed">
              You agree to indemnify and hold harmless BidBox, its affiliates, and personnel from any claims, damages, losses, or expenses arising from your use of the Service, violation of these Terms, or infringement of third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">12. Termination</h2>
            <p className="text-foreground/80 leading-relaxed">
              We may suspend or terminate your account at any time for violation of these Terms or for any other reason at our sole discretion. You may terminate your account by contacting us. Upon termination, your right to access the Service ceases, though certain provisions survive termination.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">13. Dispute Resolution</h2>
            <h3 className="text-xl font-medium mb-3 mt-4">13.1 Informal Resolution</h3>
            <p className="text-foreground/80 leading-relaxed">
              Before filing a claim, you agree to attempt to resolve disputes informally by contacting us.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-4">13.2 Arbitration</h3>
            <p className="text-foreground/80 leading-relaxed">
              Any disputes not resolved informally shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association. You waive your right to participate in class actions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">14. Governing Law</h2>
            <p className="text-foreground/80 leading-relaxed">
              These Terms are governed by the laws of [Your State/Country], without regard to conflict of law principles.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">15. Changes to Terms</h2>
            <p className="text-foreground/80 leading-relaxed">
              We may modify these Terms at any time. Material changes will be communicated through the Service or via email. Continued use after changes constitutes acceptance of the modified Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">16. Severability</h2>
            <p className="text-foreground/80 leading-relaxed">
              If any provision of these Terms is found unenforceable, the remaining provisions shall remain in full effect.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">17. Contact Information</h2>
            <p className="text-foreground/80 leading-relaxed">
              For questions about these Terms, please contact us at:
            </p>
            <p className="text-foreground/80 leading-relaxed mt-4">
              Email: legal@bidbox.com<br />
              Address: [Your Business Address]
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService;
