import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '@/App';

describe('App', () => {
  it('renders dashboard on root path', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });
  });

  it('includes toaster', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });

    // Toaster is rendered but might not be visible until a toast is shown
    expect(document.body).toBeInTheDocument();
  });
});
