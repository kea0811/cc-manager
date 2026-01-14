import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useToast, toast } from '@/hooks/use-toast';

describe('useToast hook', () => {
  it('returns empty toasts initially', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it('adds a toast', async () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Test Toast' });
    });

    await waitFor(() => {
      expect(result.current.toasts.length).toBe(1);
      expect(result.current.toasts[0].title).toBe('Test Toast');
    });
  });

  it('adds toast with description', async () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Test', description: 'Description' });
    });

    await waitFor(() => {
      expect(result.current.toasts[0].description).toBe('Description');
    });
  });

  it('adds toast with action', async () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Test', action: <button>Action</button> });
    });

    await waitFor(() => {
      expect(result.current.toasts[0].action).toBeDefined();
    });
  });

  it('dismisses a specific toast', async () => {
    const { result } = renderHook(() => useToast());

    let toastId: string;
    act(() => {
      const { id } = toast({ title: 'Test' });
      toastId = id;
    });

    await waitFor(() => {
      expect(result.current.toasts.length).toBe(1);
    });

    act(() => {
      result.current.dismiss(toastId);
    });

    await waitFor(() => {
      expect(result.current.toasts[0].open).toBe(false);
    });
  });

  it('dismisses all toasts', async () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Test 1' });
    });

    await waitFor(() => {
      expect(result.current.toasts.length).toBe(1);
    });

    act(() => {
      result.current.dismiss();
    });

    await waitFor(() => {
      expect(result.current.toasts[0].open).toBe(false);
    });
  });

  it('updates a toast', async () => {
    const { result } = renderHook(() => useToast());

    let updateFn: (props: { title: string }) => void;
    act(() => {
      const { update } = toast({ title: 'Original' });
      updateFn = update;
    });

    await waitFor(() => {
      expect(result.current.toasts[0].title).toBe('Original');
    });

    act(() => {
      updateFn({ title: 'Updated' });
    });

    await waitFor(() => {
      expect(result.current.toasts[0].title).toBe('Updated');
    });
  });

  it('returns toast function from hook', () => {
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.toast).toBe('function');
  });

  it('limits number of toasts', async () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Toast 1' });
      toast({ title: 'Toast 2' });
    });

    await waitFor(() => {
      // TOAST_LIMIT is 1
      expect(result.current.toasts.length).toBe(1);
    });
  });
});
