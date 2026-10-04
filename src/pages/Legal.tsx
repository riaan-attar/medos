import { Link, useParams } from 'react-router-dom'
import { Alert } from '../components/ui'

const DOCS: Record<string, { title: string; body: { h?: string; p: string }[] }> = {
  terms: {
    title: 'Terms of Service',
    body: [
      { p: 'These terms govern your use of MedOS, a platform that helps manufacturers, distributors, pharmacies and customers coordinate medicine inventory, orders and invoices.' },
      { h: '1. Accounts', p: 'You must provide accurate business and licence information. Businesses are responsible for holding every licence required to manufacture, stock or sell the medicines they list, and for the actions of staff they invite.' },
      { h: '2. Regulated products', p: 'You may only list and sell medicines you are legally authorised to handle. Schedule H and H1 drugs may only be sold against a valid prescription; Schedule X drugs cannot be sold through MedOS. You remain solely responsible for regulatory compliance and record keeping.' },
      { h: '3. Orders, invoices and payments', p: 'MedOS records orders, invoices and payments between users. Unless an online payment feature is explicitly enabled, MedOS does not process payments or hold funds; settlement happens directly between the parties.' },
      { h: '4. Information accuracy', p: 'Batch, expiry and recall information is entered by manufacturers and trading partners. MedOS makes no warranty that any medicine is genuine or fit for use. Always check the pack and consult a qualified professional.' },
      { h: '5. Acceptable use', p: 'Do not misuse the platform, attempt to access data you are not entitled to, or upload unlawful content. We may suspend accounts that breach these terms or applicable law.' },
      { h: '6. Liability', p: 'To the maximum extent permitted by law, MedOS is provided “as is” and is not liable for indirect or consequential loss arising from its use.' },
      { h: '7. Changes', p: 'We may update these terms; continued use after an update means you accept it.' },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      { p: 'This policy explains what personal data MedOS collects and why.' },
      { h: 'What we collect', p: 'Account details (name, email, phone, business name, address, licence and GSTIN), location you choose to share, orders and invoices, prescriptions you upload, and usage logs needed to secure the service.' },
      { h: 'How we use it', p: 'To operate the platform, show your business to trading partners, issue invoices, prevent fraud, send notifications you ask for, and meet legal obligations.' },
      { h: 'Who can see it', p: 'Trading partners see business profile details and order information relevant to them. Prescriptions are visible only to you and the pharmacy fulfilling your order. We do not sell personal data.' },
      { h: 'Retention & your rights', p: 'You may request correction or deletion of your personal data, subject to records we must keep by law (for example invoices and the Schedule H1 register).' },
      { h: 'Security', p: 'Data is stored on access-controlled infrastructure with row-level security. No system is perfectly secure; protect your password and sign out on shared devices.' },
      { h: 'Contact', p: 'Contact the operator of this MedOS instance for privacy requests.' },
    ],
  },
  refunds: {
    title: 'Refund & Cancellation Policy',
    body: [
      { p: 'This policy applies to reservations made by customers through MedOS.' },
      { h: 'Cancelling a reservation', p: 'You can cancel a reservation any time before the pharmacy hands the order over.' },
      { h: 'Returns', p: 'Medicines cannot be returned once handed over, except where the product is damaged, expired, recalled or incorrectly supplied. Contact the pharmacy directly; it will handle the refund.' },
      { h: 'Business-to-business returns', p: 'Distributors and retailers can request a return from the supplier for damaged, near-expiry, wrong or quality-complaint stock. If approved, a credit note reduces the invoice balance.' },
    ],
  },
}

export default function Legal() {
  const { doc = 'terms' } = useParams()
  const d = DOCS[doc] ?? DOCS.terms
  return (
    <div className="center-screen top">
      <article className="card wide-card stack legal">
        <Link to="/" className="brand"><span className="logo">✚</span> MedOS</Link>
        <h1>{d.title}</h1>
        <Alert tone="warn">Template text provided for convenience. Have it reviewed by a qualified lawyer before launching commercially.</Alert>
        {d.body.map((b, i) => <section key={i}>{b.h && <h3>{b.h}</h3>}<p>{b.p}</p></section>)}
        <p className="muted small">
          <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/refunds">Refunds</Link> · <Link to="/">Home</Link>
        </p>
      </article>
    </div>
  )
}
