import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
} from '@/components/ui/toast';
import { Toaster } from '@/components/ui/toaster';

describe('Toast Component', () => {
  it('renders toast with title', () => {
    render(
      <ToastProvider>
        <Toast open>
          <ToastTitle>Test Title</ToastTitle>
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders toast with description', () => {
    render(
      <ToastProvider>
        <Toast open>
          <ToastDescription>Test Description</ToastDescription>
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('renders toast with action', () => {
    const onAction = vi.fn();

    render(
      <ToastProvider>
        <Toast open>
          <ToastTitle>Test</ToastTitle>
          <ToastAction altText="Undo" onClick={onAction}>
            Undo
          </ToastAction>
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('renders toast with close button', async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <Toast open>
          <ToastTitle>Test</ToastTitle>
          <ToastClose />
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );

    const closeButton = screen.getByRole('button');
    expect(closeButton).toBeInTheDocument();
  });

  it('renders destructive variant', () => {
    render(
      <ToastProvider>
        <Toast open variant="destructive" data-testid="toast">
          <ToastTitle>Error</ToastTitle>
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByTestId('toast')).toHaveClass('destructive');
  });

  it('renders default variant', () => {
    render(
      <ToastProvider>
        <Toast open data-testid="toast">
          <ToastTitle>Default</ToastTitle>
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByTestId('toast')).not.toHaveClass('destructive');
  });

  it('renders ToastViewport with custom className', () => {
    render(
      <ToastProvider>
        <ToastViewport className="custom-viewport" data-testid="viewport" />
      </ToastProvider>
    );

    expect(screen.getByTestId('viewport')).toHaveClass('custom-viewport');
  });
});

describe('Toaster Component', () => {
  it('renders without crashing', () => {
    render(<Toaster />);
    // Toaster renders a provider, no visible content by default
    expect(document.body).toBeInTheDocument();
  });
});
