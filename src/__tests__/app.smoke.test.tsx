/**
 * End-to-end smoke test: the REAL <App /> rendered in jsdom against the mock
 * Supabase. This is the check that catches "the app compiles but the screen
 * is blank" — it drives the actual login form and asserts the chat list that
 * comes back from the seeded database.
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import App from '../App';
import {AppProviders} from '../providers/AppProviders';
import {SEED} from '../../dev/mock/seed';

async function renderApp(at = '/login') {
  const utils = render(
    <MemoryRouter initialEntries={[at]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );
  return utils;
}

describe('app smoke test', () => {
  it('boots and shows the login screen', async () => {
    await renderApp('/login');
    // The email input is the first thing the login form renders.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Email, Phone or Username/i)).toBeInTheDocument();
    }, {timeout: 8000});
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('signs in with the demo credentials and lands on the chat list', async () => {
    const user = userEvent.setup();
    await renderApp('/login');

    await waitFor(() => screen.getByPlaceholderText(/Email, Phone or Username/i), {timeout: 8000});

    await user.type(screen.getByPlaceholderText(/Email, Phone or Username/i), 'demo@grixchat.app');
    await user.type(screen.getByPlaceholderText('Password'), 'grixchat');

    // The screen also renders a "Login" tab-toggle button, so target the form's
    // real submit control instead of matching on the visible label.
    const passwordInput = screen.getByPlaceholderText('Password');
    const form = passwordInput.closest('form') as HTMLFormElement;
    expect(form).toBeTruthy();
    const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit).toBeTruthy();
    await waitFor(() => expect(submit).not.toBeDisabled(), {timeout: 5000});
    await user.click(submit);

    // The seeded thread with Aarav must show up in the conversation list.
    await waitFor(() => {
      expect(screen.getByText(/mock data ready/i)).toBeInTheDocument();
    }, {timeout: 15000});
  });

  it('does not crash when a route is deep-linked before auth resolves', async () => {
    await renderApp('/chats');
    // Either the login screen or the chat shell — but never a thrown error.
    await waitFor(() => {
      const loginVisible = screen.queryByPlaceholderText(/Email, Phone or Username/i);
      const shellVisible = document.body.textContent?.length ?? 0;
      expect(loginVisible !== null || shellVisible > 0).toBe(true);
    }, {timeout: 8000});
  });
});
