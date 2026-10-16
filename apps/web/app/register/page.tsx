import { redirect } from 'next/navigation';

// Auth removed: Free Open Talk is guest-first. No sign-up, no sign-in.
export default function RegisterPage() {
    redirect('/');
}
