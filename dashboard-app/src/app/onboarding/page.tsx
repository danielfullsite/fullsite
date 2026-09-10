import { redirect } from 'next/navigation'

// The old browser wizard wrote partial tenant data with anon credentials.
// All new restaurant creation now uses the authenticated platform workflow.
export default function OnboardingPage() {
  redirect('/platform/tenants')
}
