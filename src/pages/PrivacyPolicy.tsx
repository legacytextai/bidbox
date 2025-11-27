import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const PrivacyPolicy = () => {
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

        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">
          Last Updated: {new Date().toLocaleDateString()}
        </p>

        <div className="prose prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-foreground/80 leading-relaxed">
              BidBox ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our bid room platform and services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>
            <h3 className="text-xl font-medium mb-3 mt-4">2.1 Information You Provide</h3>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li>Account registration information (email, company name)</li>
              <li>Project details (names, locations, deadlines)</li>
              <li>Bid submissions (files, contact information)</li>
              <li>Communications with us</li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-4">2.2 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li>Device information and identifiers</li>
              <li>IP address and location data</li>
              <li>Browser type and version</li>
              <li>Usage data and analytics</li>
              <li>Cookies and similar technologies</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li>Provide, maintain, and improve our services</li>
              <li>Process and manage bid submissions</li>
              <li>Send service notifications and updates</li>
              <li>Respond to inquiries and provide support</li>
              <li>Analyze usage patterns and enhance user experience</li>
              <li>Prevent fraud and ensure platform security</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Information Sharing</h2>
            <p className="text-foreground/80 leading-relaxed mb-4">
              We do not sell your personal information. We may share information in the following circumstances:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li><strong>With Authorized Users:</strong> Project information is shared with designated contractors and subcontractors within the bid room</li>
              <li><strong>Service Providers:</strong> Third-party vendors who assist in operating our platform</li>
              <li><strong>Legal Requirements:</strong> When required by law or to protect rights and safety</li>
              <li><strong>Business Transfers:</strong> In connection with mergers, acquisitions, or asset sales</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Data Security</h2>
            <p className="text-foreground/80 leading-relaxed">
              We implement reasonable security measures to protect your information from unauthorized access, alteration, disclosure, or destruction. However, no internet transmission is completely secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Data Retention</h2>
            <p className="text-foreground/80 leading-relaxed">
              We retain your information for as long as necessary to provide services, comply with legal obligations, resolve disputes, and enforce agreements. Project and bid data may be retained for record-keeping purposes even after project completion.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Your Rights</h2>
            <p className="text-foreground/80 leading-relaxed mb-4">
              Depending on your jurisdiction, you may have the following rights:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/80">
              <li>Access your personal information</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to processing of your information</li>
              <li>Request data portability</li>
              <li>Withdraw consent where applicable</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Cookies and Tracking</h2>
            <p className="text-foreground/80 leading-relaxed">
              We use cookies and similar technologies to enhance your experience, analyze usage, and deliver relevant content. You can control cookie preferences through your browser settings, though this may affect platform functionality.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Children's Privacy</h2>
            <p className="text-foreground/80 leading-relaxed">
              Our services are not intended for individuals under 18 years of age. We do not knowingly collect information from children. If you believe we have collected such information, please contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">10. International Data Transfers</h2>
            <p className="text-foreground/80 leading-relaxed">
              Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place to protect your information in accordance with this Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Changes to This Policy</h2>
            <p className="text-foreground/80 leading-relaxed">
              We may update this Privacy Policy periodically. We will notify you of material changes by posting the new policy with an updated effective date. Continued use of our services after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">12. Contact Us</h2>
            <p className="text-foreground/80 leading-relaxed">
              For questions or concerns about this Privacy Policy or our data practices, please contact us at:
            </p>
            <p className="text-foreground/80 leading-relaxed mt-4">
              Email: privacy@bidbox.com<br />
              Address: [Your Business Address]
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
