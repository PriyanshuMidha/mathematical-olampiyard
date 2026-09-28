import NotifyForm from "../../components/NotifyForm.jsx";
// Set in frontend/.env (see frontend/.env.example). Lines are hidden when unset.
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL;
const CONTACT_PHONE = import.meta.env.VITE_CONTACT_PHONE;

export function About() {
  return (
    <main className="page narrow">
      <h1>About Mathematical Olympiad</h1>
      <p>The Mathematical Olympiad portal publishes official updates, study resources, exam notices, results and preparation materials across Foundation, Junior, Senior, National and International levels.</p>
    </main>
  );
}

export function Contact() {
  return (
    <main className="page narrow">
      <h1>Contact</h1>
      {CONTACT_EMAIL && <p>Email: <a className="text-link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>}
      {CONTACT_PHONE && <p>Phone: <a className="text-link" href={`tel:${CONTACT_PHONE.replace(/\s+/g, "")}`}>{CONTACT_PHONE}</a></p>}
      {!CONTACT_EMAIL && !CONTACT_PHONE && <p className="muted">Contact details can be added from environment settings when ready.</p>}
      <NotifyForm />
    </main>
  );
}
