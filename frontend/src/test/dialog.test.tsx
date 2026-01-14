import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogOverlay,
  DialogPortal,
} from '@/components/ui/dialog';

describe('Dialog Component', () => {
  it('opens when trigger is clicked', async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogContent>
      </Dialog>
    );

    await user.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument();
    });
  });

  it('closes when close button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button', { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText('Title')).not.toBeInTheDocument();
    });
  });

  it('renders all dialog subcomponents', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog Description</DialogDescription>
          </DialogHeader>
          <div>Content</div>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      expect(screen.getByText('Dialog Title')).toBeInTheDocument();
      expect(screen.getByText('Dialog Description')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Footer')).toBeInTheDocument();
    });
  });

  it('applies custom className to content', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent className="custom-class" data-testid="dialog-content">
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      expect(screen.getByTestId('dialog-content')).toHaveClass('custom-class');
    });
  });

  it('renders DialogOverlay with custom className', async () => {
    render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogOverlay className="custom-overlay" data-testid="dialog-overlay" />
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    );

    await waitFor(() => {
      expect(screen.getByTestId('dialog-overlay')).toHaveClass('custom-overlay');
    });
  });
});
